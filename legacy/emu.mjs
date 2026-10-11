// 让被最小化/隐藏的标签页恢复"可见+聚焦"，否则真实鼠标点击（切会话、打开抽屉）会失效。
// 注意：本机 OS 缩放 150%，实际 CSS 视口 = 传入 width/height ÷ 1.5。
// 用法：import { enableVisibility } from './emu.mjs'; await enableVisibility(cdp);
export async function enableVisibility(cdp, opts = {}) {
  const width = opts.width || 1400;
  const height = opts.height || 900;
  const out = {};
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); out.focus = 'ok'; } catch (e) { out.focus = e.message; }
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height,
    });
    out.metrics = 'ok';
  } catch (e) { out.metrics = e.message; }
  return out;
}

// 51job 页面布局宽 ~1200，须用更大视口（实际 CSS ≈ 1600×1000）才能让「立即投递」按钮落入可点区域
export const VIS_WIDE = { width: 2400, height: 1500 };
