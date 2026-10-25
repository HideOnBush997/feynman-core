# 视频片段标注平台界面规范

更新：2026-10-25。范围：现有 React / TypeScript / Vite 视频片段标注平台。

## 方向

以内容为中心的浅色专业工作台。白色导航与面板、浅灰蓝底色、靛蓝主要操作；通过字号、间距和边界组织信息。保持任务状态机和现有业务规则。

使用用户指定的 `D:/Codex/Skills/ui-ux-pro-max/SKILL.md`：检索 `enterprise SaaS dashboard minimal` 设计系统，采用命中的 Minimalism & Swiss Style、浅色表面、语义化颜色和低动效建议。第一轮视频关键词匹配到娱乐产品暗色配色，不适用于本项目，已弃用。数据库返回的营销首页结构不适用于登录后的操作界面，未采用。最终靛蓝为项目适配色；中文使用本地系统字体，避免依赖外部字体请求。

## 设计参考

- [shadcn/ui 工作台](https://github.com/shadcn-ui/ui/blob/main/apps/v4/app/%28app%29/examples/dashboard/page.tsx)：参考侧栏、顶栏、内容面板的组织方式。
- [shadcn/ui 区块目录](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry.json)：参考卡片、表格、筛选与导航的组合思路。
- [Label Studio 标注流程](https://github.com/HumanSignal/label-studio/blob/develop/docs/source/guide/labeling.md)：参考标注内容与结果区域的分工，突出保存、提交与回到任务列表。

以上仅作设计参考；未引入这些项目的源码或额外组件依赖。

## 全局令牌

具体值以 `frontend/src/styles.css` 的 `:root` 为准。

| 用途 | 令牌 | 值 |
| --- | --- | --- |
| 页面底色 | `--canvas` | `#f6f7fb` |
| 面板 | `--surface` | `#ffffff` |
| 主文字 | `--text` | `#202536` |
| 次文字 | `--muted` | `#626b80` |
| 主操作 | `--primary` | `#4f46e5` |
| 选中背景 | `--primary-soft` | `#eeedff` |
| 分隔线 | `--line` | `#e4e7ef` |
| 输入框边界 | `--control-line` | `#838da3` |

- 中文字体：Segoe UI、PingFang SC、Microsoft YaHei、系统 sans-serif；时间戳使用等宽字体。
- 标题 24–28px，任务标题 16px，正文/控件 14px，辅助信息 12–13px；手机输入框至少 16px。
- 面板圆角 14px，卡片 12px，控件 8px；主要间距采用 8/12/16/24/32px。
- 常规按钮高 44px；桌面列表中的次级操作允许更紧凑，手机提高至 44px。
- 160–180ms 颜色/边框反馈；尊重 `prefers-reduced-motion`。

## 交互约定

- 任务支持卡片与列表切换。计数来自 API 完整筛选结果，不把当前页状态数量充当全局统计。
- 日期筛选默认折叠，设置后即使收起也显示「已设置」，支持清除筛选。
- 卡片按状态、标题、说明、租户/截止时间、操作排列。取消任务使用弱化的红色文字。
- 标注区桌面左右排列，窄屏上下排列。添加片段为次要操作，提交标注为主要操作。
- 视频初始加载显示中性反馈，失败/超时后展示可读中文及重试入口，不向用户展示内部错误码。
- 弹窗打开后聚焦首个表单控件，Tab 循环，Esc 关闭，关闭后恢复触发按钮焦点；锁定背景滚动。
- 图标统一 Lucide；纯图标按钮有名称，导航与视图切换暴露选中状态。
- 手机导航允许适配；表格可在自身容器内横向滚动，整页不横向溢出。
- 当前交付仅包含浅色主题。以后扩展深色主题时独立定义并检验配色。
