"""Verify a disposable application supplied on hidden stdin; never send SMS."""
import base64
import json
import sys
import termios
import urllib.request
import urllib.error

print('Ready for disposable application JSON (input is hidden).', flush=True)
original = termios.tcgetattr(sys.stdin)
hidden = termios.tcgetattr(sys.stdin)
hidden[3] &= ~termios.ECHO
termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
try:
    fixture = json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(sys.stdin, termios.TCSANOW, original)
origin = fixture['origin']
assert origin == 'https://fpqfuignltadutstuhth.supabase.co/functions/v1/platform-api'
session = None

def call(path, method='GET', body=None, extra=None):
    headers = {'Content-Type': 'application/json'}
    if session:
        headers['X-Oneul-Application-Session'] = session
    headers.update(extra or {})
    data = body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(origin + path, data=data, method=method, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=35)
    except urllib.error.HTTPError as error:
        response = error
    result = response.read()
    if response.headers.get('Content-Type', '').startswith('application/json'):
        result = json.loads(result)
    return response.status, result, response.headers

try:
    assert call('/application')[0] == 401
    assert call('/exchange', 'POST', {'inviteToken': '0' * 64})[0] == 400
    status, result, _ = call('/exchange', 'POST', {'inviteToken': fixture['inviteToken']})
    assert status == 200 and result['exchanged']
    session = result['sessionToken']
    status, reopened, _ = call('/exchange', 'POST', {'inviteToken': fixture['inviteToken']})
    assert status == 200 and reopened['applicationId'] == fixture['applicationId']
    session = reopened['sessionToken']
    status, result, _ = call('/application')
    assert status == 200 and result['application']['id'] == fixture['applicationId']
    assert not any(key in result['application'] for key in ('invitation_hash', 'member_user_id', 'invitation_expires_at'))
    assert call('/admin/applications')[0] == 401
    assert call('/claim', 'POST', {'claimConsent': True})[0] == 401
    assert call('/application?id=00000000-0000-4000-8000-000000000000')[0] == 403
    print('PASS: repeat invitation exchange, same application, guest scope, operator isolation.', flush=True)
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=')
    paths = {}
    for slot in ('face', 'fullbody', 'employment'):
        status, result, _ = call('/file/' + slot, 'POST', png, {'Content-Type': 'image/png', 'X-Oneul-File-Consent': 'true'})
        assert status == 200 and result['uploaded'], (slot, status)
        paths[slot] = result['path']
    assert call('/file/face', 'POST', b'not a png', {'Content-Type': 'image/png', 'X-Oneul-File-Consent': 'true'})[0] == 400
    submission = {'name': '저장 검증용 임시 신청', 'phone': '01000000000', 'gender': '여성', 'birth': '1994-05-20', 'height': 155, 'region': '서울', 'district': '송파구', 'job': '테스트용 직업', 'privacyConsent': True, 'photoConsent': True, 'employmentConsent': True, 'attachments': paths}
    assert call('/profile', 'PUT', {**submission, 'privacyConsent': False})[0] == 400
    status, result, _ = call('/profile', 'PUT', submission)
    assert status == 200 and result['submitted'] and not result['cardSaved'], status
    status, result, _ = call('/application')
    assert status == 200 and result['application']['status'] == 'submitted'
    assert result['application']['profile']['phone_verified'] is False
    saved = result['application']
    status, reopened, _ = call('/exchange', 'POST', {'inviteToken': fixture['inviteToken']})
    assert status == 200 and reopened['applicationId'] == fixture['applicationId']
    session = reopened['sessionToken']
    status, result, _ = call('/application')
    assert status == 200 and result['application'] == saved
    for slot in paths:
        status, result, headers = call('/file/' + slot)
        assert status == 200 and result == png
        assert headers['Cache-Control'] == 'no-store'
    print('PASS: real private file upload/download, consent, application submission.', flush=True)
    status, result, _ = call('/file/face', 'POST', png, {'Content-Type': 'image/png', 'X-Oneul-File-Consent': 'true'})
    assert status == 200
    paths['face'] = result['path']
    assert call('/profile', 'PUT', {**submission, 'attachments': paths})[0] == 200
    print('PASS: replacement submission queues previous file for cleanup.', flush=True)
    print(json.dumps({'passed': True, 'applicationId': fixture['applicationId'], 'filesUploaded': 4}), flush=True)
except Exception as error:
    print('FAIL: ' + type(error).__name__ + ' ' + str(error), flush=True)
    sys.exit(1)
