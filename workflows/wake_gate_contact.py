import sys, time, os, re, json
from datetime import datetime, timezone, timedelta

# Operit 的 updatedAt 是手机本地时间（Asia/Shanghai, UTC+8），无时区后缀
SHANGHAI = timezone(timedelta(hours=8))

STATE_FILE = '/sdcard/Download/Operit/plugins/com.shenyu.wake_veil/state.json'
CURSOR_FILE = '/sdcard/Download/Operit/plugins/com.shenyu.wake_veil/cursor.json'
PREFS_FILE = '/data/data/com.ai.assistance.operit/shared_prefs/toolpkg_shenyu_wake_veil.xml'

def parse_ts(ts):
    """兼容毫秒/秒时间戳与 ISO 字符串；ISO 按东八区本地时间解析"""
    s = str(ts).strip() if ts is not None else ''
    if not s:
        return 0
    if s[0].isdigit():
        try:
            t = int(s)
            if t < 100000000000:
                t *= 1000
            return t
        except Exception:
            pass
    try:
        for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S'):
            try:
                dt = datetime.strptime(s[:23], fmt).replace(tzinfo=SHANGHAI)
                return int(dt.timestamp() * 1000)
            except Exception:
                continue
    except Exception:
        pass
    return 0

def read_json_ts(path, key):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        cur = data
        for k in key.split('.'):
            cur = cur[k]
        return int(cur) if cur else 0
    except Exception:
        return 0

def read_cooldown_minutes():
    """读取宝宝在面板设置的冷却分钟（默认30）。
    2026-09-11修复：改用 ElementTree 解析XML，由解析器自动处理 " 实体，不再手动正则抠。"""
    try:
        import xml.etree.ElementTree as ET
        tree = ET.parse(PREFS_FILE)
        root = tree.getroot()
        for el in root.iter('string'):
            if el.get('name') == 'wake_veil_config':
                cfg = json.loads(el.text or '{}')
                v = int(cfg.get('cooldownMinutes', 0))
                if 1 <= v <= 120:
                    return v
                break
    except Exception:
        pass
    return 30  # 读不到就用默认30

now_ms = int(time.time() * 1000)
arg = sys.argv[1] if len(sys.argv) > 1 else None
last_chat_ms = parse_ts(arg)

# 关键修复：最后接触时间取三者最晚者——主窗口更新 / 内核上次唤醒 / cursor 上次可见
last_wake_ms = read_json_ts(STATE_FILE, 'activationState.lastSpontaneousWakeAtMs')
last_seen_ms = read_json_ts(CURSOR_FILE, 'lastSeenAtMs')
last_contact_ms = max(last_chat_ms, last_wake_ms, last_seen_ms)

cooldown_ms = read_cooldown_minutes() * 60 * 1000

# 距最近一次接触/唤醒不足冷却时长 => 还在聊/刚醒过：SKIP，不调 wake_tick，不累计阈值
if last_contact_ms <= 0 or now_ms - last_contact_ms < cooldown_ms:
    print('SKIP')
else:
    print('PROCEED')