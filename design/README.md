# 桌面交互原型

本次交付只用于 review：一张规则表，支持每组规则独立启停、选择环境和测试机、添加/编辑/删除，以及 YAML 导入导出。配置保存在当前浏览器本地。

在项目目录运行：

```sh
pnpm dlx http-server design/prototype -a 127.0.0.1 -p 4317 -c-1
```

打开 <http://127.0.0.1:4317/>。按 `Ctrl+C` 停止。

原型使用 daisyUI、Tailwind 和 js-yaml 的 CDN，需要网络。正式 Vue 应用在设计 review 后实现，使用构建依赖。应用按钮只演示反馈，不会连接或修改 Whistle。

- 方案：`方案.md`
- 示例配置：`nlab-easy-whistle.example.yaml`
- Figma：<https://www.figma.com/design/tcitG8Ch5UHOTk61d87dvk?node-id=7-720>
- 桌面设计截图：`desktop-review.png`

模型检查：

```sh
node --test design/prototype/model.test.mjs
```

已验证每组独立切换与启停、新增测试机、规则增删编辑、刷新记忆、YAML 导出再导入，以及非法导入不覆盖现有配置。模型检查 2 项通过。Figma 保留可编辑文字、Auto Layout、daisyUI 按钮/开关实例和本地原生 select 组件。
