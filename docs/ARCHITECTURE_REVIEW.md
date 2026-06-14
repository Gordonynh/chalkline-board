# OpenWhiteboard / Chalkline Board 代码复盘

本项目现在是一套源码、三种发布形态：

- 纯白版：通用白板，公开 GitHub 版本，不包含教材图片资源。
- 教材版：课堂教材批注版本，启用书籍选择、章节目录、本地教材图片资源和桌面单文件发布。
- 投影版：视频展台/投影批注版本，保留投影画面、画笔、橡皮、漫游和拍照等展台流程。

## 统一入口与变体

核心变体定义在 `scripts/release.config.mjs`。`chalkline`、`textbook`、`visualizer` 三个 app 共用同一个桌面壳工程和前端基础代码，通过 `mode`、`packageDir`、`includesTextbookResources`、图标和输出目录区分。

前端入口在 `src/main.tsx`。构建脚本 `scripts/whiteboard.mjs` 会给 Vite 注入当前 app mode，并通过别名把书籍数据切到纯白版或教材版：

- 纯白版使用 `src/books.blank.ts`，只包含空白画布。
- 教材版使用 `src/books.textbook.ts`，包含两套本地书籍、封面路径、页数、图片尺寸和目录。
- 投影版加载 `src/ProjectionApp.tsx`，不加载教材目录和白板书籍选择。

这样做的目的，是让三个版本共享绘图、导入、发布、桌面壳和测试逻辑，同时避免公开版本把教材资源或教材专用功能打进包里。

## 纯白版设计

纯白版主界面由 `src/App.tsx`、`src/components/WhiteboardChrome.tsx`、`src/components/WhiteboardPanels.tsx` 和 `src/App.css` 组成。

主要功能：

- 空白画布与图片/PDF/PPT/Office 导入。
- 软笔、荧光笔、橡皮、激光笔、选择、撤销、漫游。
- 工具栏底部贴边，工具设置使用独立面板。
- `.owbn` 白板笔记格式保存和打开。
- PNG/PDF/项目 JSON 导出。
- 独立计时器窗口和课堂快捷操作。

核心原理：

- Konva 负责稳定的页面、图片和已提交笔迹渲染。
- `src/whiteboard/liveInk.ts` 用原生 canvas 做低延迟实时笔迹预览，提交后再进入结构化 stroke 数据。
- `src/whiteboard/strokes.ts` 使用 `perfect-freehand` 风格的压力/速度曲线生成笔迹轮廓，结尾笔锋更强，主体笔锋较弱，避免长线条整体变细。
- `src/whiteboard/eraser.ts` 和 `App.tsx` 中的擦除逻辑按路径切割笔迹，避免整条删除，并让橡皮大小可随速度调整。
- `src/whiteboard/gestures.ts` 处理漫游和双指缩放，笔画宽度按白板坐标固定，避免随视图缩放变粗变细。

## 教材版设计

教材版复用白板主界面，但启用 `src/books.textbook.ts`：

- `textbook-main`：主讲义，260 页，图片路径 `/book`。
- `textbook-110`：一轮复习 110 练，212 页，图片路径 `/book-110`。
- `src/toc.ts`：主讲义章节目录。
- `src/practice110Toc.ts`：110 练章节目录。

工具栏中的“书籍”和“目录”按钮由 `bookPickerEnabled` 和 `tocEnabled` 控制。`tocEnabled` 来自当前书籍的 `toc.length > 0`。本轮修复把两个教材的 `toc: []` 恢复为真实目录数据，因此教材版工具栏目录入口会重新出现，并可跳转到对应源页。

资源边界：

- 教材图片目录在 `public-textbook/book/` 和 `public-textbook/book-110/`。
- `.gitignore` 明确排除教材图片包，公开 GitHub 只保留代码、目录结构和加载逻辑。
- 发布教材版时，`release.mjs` 会把本机授权教材资源复制进教材版输出；纯白版和投影版不会包含这些目录。

## 投影版设计

投影版主代码在 `src/ProjectionApp.tsx`，桌面壳同样使用 `desktop-shell`，但通过 `--app=visualizer` 和 `variant.json` 强制加载投影包。

主要功能：

- 摄像头/投影画面显示。
- 画笔、橡皮、漫游、撤销/重做、清除批注。
- 拍照、相册、旋转画面和批注。
- 工具栏样式与白板版保持一致，中文标签统一。

核心原理：

- 视频画面和批注分层渲染，旋转时同步变换画面与笔迹坐标。
- 投影画笔使用固定屏幕视觉粗细，避免放大后笔迹变虚或过粗。
- 漫游和橡皮优先走轻量状态更新，减少投影画面刷新卡顿。

## 桌面壳与发布

桌面壳在 `desktop-shell/MainWindow.xaml.cs`：

- 使用 WebView2 承载前端构建产物。
- 每个 app 使用独立数据目录和独立虚拟主机，避免纯白版、教材版、投影版串包。
- 启动时读取 `variant.json` 和资源标记，拒绝加载错误包。
- 单文件教材版优先读取嵌入资源，解决教材单 exe 分发问题。

发布脚本：

- `scripts/release.mjs`：按 profile 和 format 构建 multifile、singlefile、installer。
- `scripts/deploy-desktop.mjs`：发布课堂桌面版本。
- `scripts/verify-desktop-deployment.mjs`：发布后验证桌面 exe、快捷方式、variant、嵌入资源、缓存和运行进程。
- `scripts/desktop-contract-gate.mjs`：防回归契约。

本轮发布安全修复：

- 桌面旧 `步步高v*.exe` 和旧 `OpenWhiteboard*.exe` 不再直接删除，改为移动到 `release-unified/<version>/quarantine/desktop-backup/`。
- 重复课堂快捷方式不再删除，改为隔离。
- 已存在的托管快捷方式在覆盖前会备份。
- `app-cache` 和 `WebView2` 默认只报告，不清理；只有显式 `--clear-cache` 才隔离。
- 每次部署生成 `release-unified/<version>/desktop-audit.json`。
- 每次部署生成 `release-unified/<version>/restore-desktop-state.mjs`，可恢复本次部署影响的桌面 exe、快捷方式和被隔离目录。

## 主要修复问题

- 教材版被误发布成纯白版：通过 variant marker、资源校验和发布契约防止串包。
- 投影入口被误指向白板：桌面快捷方式固定使用 `--app=visualizer`，验证脚本检查目标路径和参数。
- 教材目录丢失：恢复 `src/toc.ts`、`src/practice110Toc.ts`，并接回 `src/books.textbook.ts`。
- 笔迹触摸闪烁：实时预览与提交笔迹分离，减少最终 stroke 与预览 stroke 的视觉差。
- 橡皮卡顿：擦除采样、命中检测和游标绘制分离，避免每个输入事件都触发重渲染。
- 漫游卡顿：手势逻辑独立，减少页面级状态更新。
- 公开仓库误含教材风险：教材图片包被 `.gitignore` 排除，公开版只含加载代码和目录元数据。
- 发布误删风险：桌面清理全部改为审计、隔离和恢复。

## 验证命令

常用验证：

```powershell
npm.cmd run desktop:contract
npm.cmd run release:logic
npm.cmd run build
npm.cmd run build:textbook
npm.cmd run build:visualizer
```

发布桌面：

```powershell
npm.cmd run deploy:desktop
```

发布后验证：

```powershell
npm.cmd run verify:desktop -- --version <version>
```

如需显式隔离缓存：

```powershell
npm.cmd run deploy:desktop -- --clear-cache
```
