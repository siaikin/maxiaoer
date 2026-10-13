/**
 * 页面里注入的诱饵元素：克隆真实按钮，透明、aria-hidden、不进 tab 序列，真人看不见也点不到。
 * 小红书发布页的顶部 tab 就有这种克隆（button-hp-installed / data-hp-kind），点中即可判定为脚本。
 * 这里是页面内执行的函数源码，定位和打标记时都要先排除这些元素。
 */
export const IS_DECOY = `((el) => {
  if (el.hasAttribute('button-hp-installed') || el.hasAttribute('data-hp-kind')) return true
  if (el.getAttribute('aria-hidden') === 'true') return true
  for (let e = el; e; e = e.parentElement) {
    if (parseFloat(getComputedStyle(e).opacity) < 0.1) return true
  }
  return false
})`
