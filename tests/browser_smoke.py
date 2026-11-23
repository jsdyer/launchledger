"""CI-only browser check, served at the real project subpath."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

def main():
 screenshots=ROOT/'browser-checks';screenshots.mkdir(exist_ok=True)
 with tempfile.TemporaryDirectory() as temp:
  shutil.copytree(ROOT/'dist',Path(temp)/'launchledger')
  server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=temp));threading.Thread(target=server.serve_forever,daemon=True).start()
  try:
   with sync_playwright() as p:
    browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}/launchledger/')
    expect(page.locator('#capture-select')).to_be_enabled()
    idx=json.loads((ROOT/'web/data/index.json').read_text());data=json.loads((ROOT/'web/data'/idx['captures'][0]['file']).read_text());primary_key=idx['captures'][0]['file']
    if not data['launches']:
     data['launches']=[{'id':'00000000-0000-4000-8000-000000000001','name':'CI test launch','net':'2026-11-23T12:00:00Z','precision':{'name':'Minute'},'status':{'id':1,'name':'Go for Launch'},'provider':'Test provider','pad':'Test pad'}]
     page.locator('#import-json').set_input_files({'name':'test-receipt.json','mimeType':'application/json','buffer':json.dumps(data).encode()});expect(page.locator('#notice')).to_contain_text('Imported into this tab');primary_key=page.locator('#capture-select').input_value()
    expect(page.locator('.launch').first).to_be_visible();count=page.locator('.launch').count();uid=data['launches'][0]['id']
    page.locator('#search').fill(uid);expect(page.locator('.launch')).to_have_count(1);page.locator('.launch').click();expect(page.locator('#detail')).to_contain_text(uid)
    page.locator('#search').fill('impossible-zxy987');expect(page.locator('#empty')).to_be_visible();page.locator('#reset').click();expect(page.locator('.launch')).to_have_count(count)
    with page.expect_download() as download:page.locator('#export-json').click()
    assert download.value.suggested_filename.endswith('.json')
    # Imported strings are rendered as text; an older receipt enables real comparison.
    data['capturedAt']='2026-01-01T00:00:00Z';data['launches'][0]['net']='2027-01-01T12:00:00Z';data['launches'][0]['name']='<img src=x onerror="alert(1)">'
    page.locator('#import-json').set_input_files({'name':'receipt.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
    expect(page.locator('#notice')).to_contain_text('Imported into this tab');expect(page.locator('#detail-title')).to_contain_text('<img');assert page.locator('img').count()==0
    imported=page.locator('#capture-select').input_value()
    page.locator('#capture-select').select_option(primary_key);expect(page.locator('#baseline-select')).to_be_enabled();page.locator('#baseline-select').select_option(imported);expect(page.locator('#change-count')).to_have_text('1');page.locator('#changed-only').check();expect(page.locator('.launch')).to_have_count(1)
    page.locator('#reset').click();page.screenshot(path=str(screenshots/'desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(screenshots/'mobile.png'),full_page=True)
    assert not errors,errors;browser.close()
   print('Browser checks passed: retained data, filters, safe import, comparison, export, mobile layout')
  finally:server.shutdown()
if __name__=='__main__':main()
