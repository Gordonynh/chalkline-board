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

## 资源边界

本仓库只包含公开白板代码和通用资源。请不要提交教材图片、PDF、学校内部资料或未授权品牌素材。

## 许可证

MIT License。详见 [LICENSE](LICENSE)。

