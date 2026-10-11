import subprocess, time, glob, os

base = r'C:/Users/rainb/WorkBuddy/automation-2026-10-09-22-45-06/job'
KEYS = ['boss_', 'lp_', 'liepin_', 'zhilian_', 'job51_', '_diag.mjs', 'emu', 'win_diag', 'restore_win',
        'chat.mjs', 'apply.mjs', 'scan', 'probe_l', 'p_login', 'build_', 'filter', 'jd.mjs', '_tab.mjs',
        'realclick', 'btn_probe', 'insp_']


def scripts():
    try:
        p = subprocess.run(['wmic', 'process', 'where', "name='node.exe'", 'get', 'CommandLine'],
                           capture_output=True)
        out = p.stdout.decode('utf-8', 'ignore')
    except Exception as e:
        return ['ERR:' + str(e)]
    hits = []
    for ln in out.splitlines():
        ln = ln.strip()
        if not ln or ln == 'CommandLine':
            continue
        if 'plugins' in ln or 'preload' in ln:
            continue
        if any(k in ln for k in KEYS):
            hits.append(ln[:150])
    return hits


def mx():
    m = 0.0
    for f in glob.glob(base + '/*'):
        try:
            m = max(m, os.path.getmtime(f))
        except Exception:
            pass
    return m


start = time.time()
quiet = 0
last_report = 0
while time.time() - start < 1800:
    time.sleep(30)
    s = scripts()
    changed = mx()
    if s:
        quiet = 0
        print('[%s] SCRIPTS=%d %s' % (time.strftime('%H:%M:%S'), len(s), s[0]), flush=True)
    else:
        quiet += 1
        print('[%s] no-script quiet=%ds lastfile=%s' % (time.strftime('%H:%M:%S'), quiet * 30,
              time.strftime('%H:%M:%S', time.localtime(changed))), flush=True)
        if quiet >= 3:
            print('OTHER_RUN_DONE', flush=True)
            break
print('watcher exit', flush=True)
