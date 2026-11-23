import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from refresh import collect, normalize, save_capture, validate_config, ROOT

UID='00000000-0000-4000-8000-000000000001'
ITEM={'id':UID,'name':'A test mission','net':'2027-01-02T12:00:00Z','last_updated':'2026-11-23T00:00:00Z','status':{'id':2,'name':'To Be Determined'},'net_precision':{'name':'Month'},'launch_service_provider':{'id':1,'name':'Test agency'},'pad':{'name':'Test pad'}}
NOW=datetime(2026,11,23,8,0,tzinfo=timezone.utc)
class RefreshTests(unittest.TestCase):
 def setUp(self): self.config=json.loads((ROOT/'web/config.json').read_text())
 def page(self,items=None,next=None,count=1):return {'results':[ITEM] if items is None else items,'next':next,'count':count}
 def test_normalization_keeps_precision_and_separates_source_updated_from_capture(self):
  r=normalize(ITEM);self.assertEqual(r['precision']['name'],'Month');self.assertEqual(r['lastUpdated'],'2026-11-23T00:00:00Z');self.assertNotIn('image',r)
 def test_collector_uses_config_and_rejects_truncated_window(self):
  self.config.update(maxPages=1,search='Falcon',providerId='121');urls=[]
  def fetch(url):urls.append(url);return self.page(next='https://ll.thespacedevs.com/2.3.0/launches/?offset=100',count=150)
  with self.assertRaisesRegex(ValueError,'exceeds maxPages'):collect(self.config,fetch,NOW)
  self.assertEqual(len(urls),1);self.assertIn('search=Falcon',urls[0]);self.assertIn('lsp__id=121',urls[0]);self.assertIn('net__gte=2026-11-09',urls[0])
 def test_watch_uuid_outside_date_window_is_added_and_duplicates_not_requested(self):
  self.config['watchIds']=[UID];urls=[]
  def fetch(url):urls.append(url);return ITEM if UID in url else self.page(items=[],count=0)
  c=collect(self.config,fetch,NOW);self.assertEqual(len(c['launches']),1);self.assertEqual(len(urls),2)
  urls.clear()
  c=collect(self.config,lambda url:(urls.append(url) or self.page()),NOW);self.assertEqual(len(urls),1)
 def test_foreign_pagination_and_bad_rows_are_rejected(self):
  with self.assertRaisesRegex(ValueError,'outside'):collect(self.config,lambda url:self.page(next='https://example.com/data'),NOW)
  with self.assertRaises(ValueError):collect(self.config,lambda url:self.page(items=[{'id':'bad'}]),NOW)
 def test_budget_is_validated_before_requests(self):
  self.config.update(maxPages=4,maxRequests=2)
  with self.assertRaisesRegex(ValueError,'budget|exceeds'):validate_config(self.config)
 def test_atomic_capture_and_retention_keep_first_capture_date(self):
  c=collect(self.config,lambda u:self.page(),NOW)
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory);first=save_capture(c,p,2);before=(p/'index.json').read_bytes()
   with self.assertRaises(ValueError):collect(self.config,lambda u:{'error':'unavailable'},NOW)
   self.assertEqual((p/'index.json').read_bytes(),before)
   for date in ['2026-11-24T08:00:00Z','2026-11-25T08:00:00Z']:
    second=copy.deepcopy(c);second['capturedAt']=date;save_capture(second,p,2)
   index=json.loads((p/'index.json').read_text());self.assertEqual(len(index['captures']),2);self.assertEqual(index['firstCapturedAt'],c['capturedAt']);self.assertFalse((p/first).exists())
