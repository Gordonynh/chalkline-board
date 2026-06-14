# Chalkline Board

Chalkline Board 是一个本地优先的课堂白板，面向授课批注、空白书写和图片讲解。项目从 ClearBoard/OpenWhiteboard 代码线拆分为独立公开版本，不包含任何教材图片、学校内部资源或第三方品牌素材。

## 功能

- 空白白板与本地图片导入
- 手写笔、荧光笔、橡皮、激光笔和漫游
- 撤销、页面管理、保存笔记文件和导出图片/PDF
- 触控、鼠标、手写笔统一输入
- Windows 桌面壳，支持绿色版和标准 Inno Setup 安装包

## 开发

```bash
npm ci
npm run dev
npm run build
npm run release:installer
```

安装包由 `scripts/release.mjs` 调用 Inno Setup 6 的 `ISCC.exe` 生成，不使用自写安装器。

## 桌面课堂发布

面向本机授课使用的桌面发布必须通过：

```bash
npm run deploy:desktop
npm run verify:desktop
```

发布契约：

- `deploy:desktop`、`deploy:classroom` 和 `desktop:deploy` 都指向同一个受保护的课堂发布脚本；不要用低层 `desktop:publish*` 脚本替代课堂发布。
- 教材版必须发布为单文件 EXE，并复制到桌面，命名为 `步步高v<版本>.exe`。
- 管理员桌面只能保留最新的 `步步高v*.exe`；旧教材 EXE 会在发布时清理。
- 公共桌面不能保留任何 `步步高v*.exe`；公共桌面只放课堂快捷方式。
- 白板入口必须是桌面快捷方式 `鸿合白板软件.lnk`，指向同一版本发布目录中的纯白白板多文件程序。
- 投影入口必须是桌面快捷方式 `鸿合视频展台.lnk`，指向同一版本发布目录中的投影多文件程序。
- 管理员桌面和公共桌面的两个快捷方式都要更新。
- 发布时会清理同名前缀的重复课堂快捷方式，验证时也会拒绝这类残留入口。
- `deploy:desktop` 会先运行预检再发布，更新桌面后还会运行严格桌面验证。
- `desktop:contract` 已接入预检，会在桌面发布前检查脚本级发布契约。
- `verify:desktop` 会检查版本一致性、旧桌面 EXE 清理、教材资源、投影 bundle、快捷方式精确目标，以及桌面 EXE 与单文件发布产物的 SHA256。
- 如需验证指定版本，可通过 npm 透传版本号：`npm run verify:desktop -- --version 0.613.19`。

## 资源边界

本仓库只包含公开白板代码和通用资源。请不要提交教材图片、PDF、学校内部资料或未授权品牌素材。

## 许可证

MIT License。详见 [LICENSE](LICENSE)。
