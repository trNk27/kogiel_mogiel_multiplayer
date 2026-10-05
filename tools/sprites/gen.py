"""Generate one image with the Black Forest Labs API.

Usage: BFL_API_KEY=... python3 gen.py model out.png "prompt" [w h] [ref1 ref2 ...]
"""
import base64, json, sys, time, urllib.request, urllib.error, os
KEY = os.environ.get('BFL_API_KEY', '')
if not KEY:
    raise SystemExit('Set BFL_API_KEY to your Black Forest Labs API key.')
H = {'x-key': KEY, 'Content-Type': 'application/json', 'accept': 'application/json'}

def call(url, body=None):
    for attempt in range(6):
        try:
            return _call(url, body)
        except urllib.error.HTTPError as e:
            if e.code != 429 and (body is not None or attempt == 5): raise
            if attempt == 5: raise
            time.sleep(4 * (attempt + 1))
        except Exception:
            if body is not None or attempt == 5: raise
            time.sleep(2 * (attempt + 1))

def fetch(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                return resp.read()
        except Exception:
            if attempt == 5: raise
            time.sleep(2 * (attempt + 1))

def _call(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=H, method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

def credits():
    return call('https://api.bfl.ai/v1/credits')['credits']

def gen(model, out, prompt, w=1024, h=1024, refs=(), extra=None):
    body = {'prompt': prompt, 'output_format': 'png'}
    if model.startswith('flux-3'):
        body = {'prompt': prompt, 'aspect_ratio': '1:1', 'resolution': '1k', 'grounding': False}
        if refs: body['images'] = [base64.b64encode(open(r, 'rb').read()).decode() for r in refs]
    else:
        body.update({'width': w, 'height': h})
        for i, r in enumerate(refs):
            body['input_image' if i == 0 else f'input_image_{i+1}'] = base64.b64encode(open(r, 'rb').read()).decode()
    if extra: body.update(extra)
    job = call(f'https://api.bfl.ai/v1/{model}', body)
    poll = job.get('polling_url') or f"https://api.bfl.ai/v1/get_result?id={job['id']}"
    for _ in range(240):
        time.sleep(1.5)
        r = call(poll)
        st = r.get('status')
        if st == 'Ready':
            url = r['result']['sample']
            open(out, 'wb').write(fetch(url))
            return job
        if st not in ('Pending', 'Processing', 'Queued'):
            raise SystemExit(f'failed: {r}')
    raise SystemExit('timeout')

if __name__ == '__main__':
    model, out, prompt = sys.argv[1:4]
    rest = sys.argv[4:]
    w = h = 1024
    if len(rest) >= 2 and rest[0].isdigit():
        w, h = int(rest[0]), int(rest[1]); rest = rest[2:]
    c0 = credits()
    job = gen(model, out, prompt, w, h, rest)
    print('cost', job.get('cost'), 'credits used', round(c0 - credits(), 2), 'left', credits())
