import os, time, glob

base = r'C:/Users/rainb/WorkBuddy/automation-2026-10-09-22-45-06/job'

def mx():
    m = 0.0
    for f in glob.glob(base + '/*'):
        try:
            m = max(m, os.path.getmtime(f))
        except Exception:
            pass
    return m

last = mx()
idle = 0
start = time.time()
print('start maxmtime', time.strftime('%H:%M:%S', time.localtime(last)), flush=True)
while time.time() - start < 1500:
    time.sleep(20)
    c = mx()
    if c > last + 0.5:
        last = c
        idle = 0
    else:
        idle += 1
        print('idle=%d quiet=%ds lastchange=%s' % (idle, idle * 20, time.strftime('%H:%M:%S', time.localtime(last))), flush=True)
        if idle >= 6:
            print('RUN_IDLE_STOP', flush=True)
            break
print('done', flush=True)
