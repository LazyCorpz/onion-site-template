"""Sends raw HTTP requests to each nginx container and classifies the replies."""
import socket
import sys

TARGETS = [('before/live', 8081), ('before/dead', 8082), ('after/live', 8083), ('after/dead', 8084)]
H = 'Host: localhost\r\nConnection: close\r\n'


def req(line, headers=H, body=b''):
    return (line + '\r\n' + headers + '\r\n').encode() + body


BIG = b'x' * (2 * 1024 * 1024)
CASES = [
    ('GET /', req('GET / HTTP/1.1')),
    ('HEAD /', req('HEAD / HTTP/1.1')),
    ('POST / small', req('POST / HTTP/1.1', H + 'Content-Type: application/x-www-form-urlencoded\r\nContent-Length: 3\r\n', b'a=b')),
    ('POST / 2 MiB', req('POST / HTTP/1.1', H + 'Content-Length: %d\r\n' % len(BIG), BIG)),
    ('TRACE /', req('TRACE / HTTP/1.1')),
    ('CONNECT', req('CONNECT example.com:443 HTTP/1.1', 'Host: example.com:443\r\nConnection: close\r\n')),
    ('PUT /', req('PUT / HTTP/1.1', H + 'Content-Length: 0\r\n')),
    ('DELETE /', req('DELETE / HTTP/1.1')),
    ('OPTIONS /', req('OPTIONS / HTTP/1.1')),
    ('PATCH /', req('PATCH / HTTP/1.1', H + 'Content-Length: 0\r\n')),
    ('PROPFIND /', req('PROPFIND / HTTP/1.1')),
    ('FOO / (unknown)', req('FOO / HTTP/1.1')),
    ('get / (lowercase)', req('get / HTTP/1.1')),
    ('no Host (1.1)', req('GET / HTTP/1.1', 'Connection: close\r\n')),
    ('garbage line', b'hello\r\n\r\n'),
    ('HTTP/3.0', req('GET / HTTP/3.0')),
    ('URI 9000 chars', req('GET /' + 'a' * 9000 + ' HTTP/1.1')),
    ('Cookie 20 KB', req('GET / HTTP/1.1', H + 'Cookie: c=' + 'x' * 20000 + '\r\n')),
    ('TE + CL', req('POST / HTTP/1.1', H + 'Transfer-Encoding: chunked\r\nContent-Length: 3\r\n', b'0\r\n\r\n')),
    ('GET /error.html', req('GET /error.html HTTP/1.1')),
]


def send(port, raw):
    s = socket.create_connection(('127.0.0.1', port), timeout=10)
    try:
        try:
            s.sendall(raw)
        except OSError:
            pass
        data = b''
        while True:
            try:
                chunk = s.recv(65536)
            except OSError:
                break
            if not chunk:
                break
            data += chunk
        return data
    finally:
        s.close()


def classify(data):
    if not data:
        return 'no reply', ''
    if data.startswith(b'HTTP/'):
        head, _, body = data.partition(b'\r\n\r\n')
        lines = head.decode('latin-1').split('\r\n')
        status = lines[0].split(' ', 2)[1]
        server = [line for line in lines[1:] if line.lower().startswith('server:')]
    else:
        status, body, server = 'no-status-line', data, []
    low = body.lower()
    if b'openresty' in low or b'<center>nginx' in low:
        kind = 'BUILTIN'
    elif b"please contact this site" in low:
        kind = 'custom'
    elif b'upstream ok' in low or b'error response' in low:
        kind = 'upstream'
    elif not body:
        kind = 'no body'
    else:
        kind = 'other'
    if server:
        kind += ' +' + server[0]
    return status, kind


rows = []
leaks = {'before': 0, 'after': 0}
for name, raw in CASES:
    cells = []
    for label, port in TARGETS:
        try:
            status, kind = classify(send(port, raw))
        except OSError as e:
            status, kind = 'ERR', type(e).__name__
        if 'BUILTIN' in kind or '+Server' in kind or '+server' in kind:
            leaks[label.split('/')[0]] += 1
        cells.append('%s %s' % (status, kind))
    rows.append('| %s | %s |' % (name, ' | '.join(cells)))

out = ['| request | ' + ' | '.join(t[0] for t in TARGETS) + ' |', '|---' * (len(TARGETS) + 1) + '|'] + rows
out.append('')
out.append('replies that name the server: before %d, after %d' % (leaks['before'], leaks['after']))
text = '\n'.join(out)
print(text)
if len(sys.argv) > 1:
    with open(sys.argv[1], 'a') as f:
        f.write(text + '\n')
