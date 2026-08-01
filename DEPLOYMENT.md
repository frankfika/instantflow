# 上线与运维

## 架构

- Cloudflare Worker：同域提供网页和 API。
- Durable Objects：隔离房间、配对码映射、分块密文和分布式限流。
- Alarm：到期触发删除；接收完成和发送方撤销会立即删除。

## 首次发布

1. 安装依赖：`npm ci`
2. 登录：`npx wrangler login`
3. 完整检查：`npm run check`
4. 发布：`npm run deploy`

发布后用两台不同设备完成一次文本和文件传输，并检查以下事项：页面只能通过 HTTPS 打开；双方安全校验码一致；错误配对码会失败；接收后原配对码不能复用；发送方撤销后接收方无法再下载。

## 自定义域名

在 Cloudflare 控制台为 Worker 添加自定义域名。网页和 `/api` 必须保持同域；生产 Worker 会拒绝来自其他 Origin 的浏览器请求。添加自定义域名后，建议关闭不再需要的 `workers.dev` 和预览地址，减少公开入口。

## 运维基线

- 为 5xx、删除失败和异常高的 429 建立告警。
- 每月运行依赖审计，发布前执行 `npm run check`。
- 在 GitHub 启用 Dependabot、Secret scanning、Push protection、CodeQL 和私密漏洞报告；保护 `main` 分支并要求 CI 全部通过。
- 不在日志、错误追踪或客服工单中记录配对码、房间 ID 和访问令牌。
- 出现疑似前端篡改时立即回滚 Worker，暂停服务并轮换 Cloudflare 发布凭据。
