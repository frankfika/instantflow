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

## CI/CD 自动化

项目使用 GitHub Actions 实现完整的 CI/CD 流水线，包含四个工作流文件：

### 工作流总览

| 文件 | 触发条件 | 功能 |
|------|----------|------|
| `ci.yml` | push 到 main / 所有 PR | 构建、测试、类型检查、依赖审计、密钥扫描 |
| `deploy.yml` | push 到 main / PR 标记 `deploy:preview` | 生产部署 / 预览部署 |
| `release.yml` | 推送 `v*.*.*` 标签 | 创建 GitHub Release + 构建产物归档 |
| `codeql.yml` | push 到 main / PR / 每周一 | CodeQL 安全分析（security-extended） |

### CI 流水线 (`ci.yml`)

三个并行 Job：

1. **Build & Lint** — 构建前端、Worker 类型检查、`wrangler deploy --dry-run` 验证打包结果，上传 `dist/` 为 artifact（保留 7 天）。
2. **Tests** — 运行 `npm test`（含单元测试和 API 安全集成测试，后者会启动本地 Node 服务器进行端到端验证）。
3. **Security Audit** — `npm audit` 分级扫描 + gitleaks 密钥泄露检测。

PR 会自动取消旧的运行以节省资源（`cancel-in-progress`）。

### 部署流水线 (`deploy.yml`)

**生产部署**（main 分支 push）：
1. 预检：构建 + 测试 + 类型检查 + dry-run 验证全部通过。
2. 部署：`npx wrangler deploy` 使用 `CLOUDFLARE_API_TOKEN` 发布到 Cloudflare Workers。
3. 冒烟测试：对 `https://usend.xyz/` 执行 `npm run test:edge`，验证健康检查、房间创建、配对、上传、下载和删除全流程。

**预览部署**（PR 添加 `deploy:preview` 标签）：
1. 预检全部通过后，发布独立的 `instantflow-pr-{number}` Worker。
2. 自动在 PR 评论中贴出预览 URL（幂等：更新已有评论而非重复创建）。

### 发布流程 (`release.yml`)

```bash
git tag v0.2.0
git push origin v0.2.0
```

推送标签后自动：
1. 构建并测试。
2. 从上一个标签生成 changelog。
3. 创建 GitHub Release 并附加 `dist-production.tar.gz`。
4. 含 `-` 的标签（如 `v0.2.0-rc1`）自动标记为 prerelease。

### 所需 GitHub Secrets

| Secret 名称 | 用途 | 获取方式 |
|--------------|------|----------|
| `CLOUDFLARE_API_TOKEN` | Workers 部署 | Cloudflare Dashboard → My Profile → API Tokens → 创建令牌（权限：Workers Scripts:Edit + Account:Read） |

`GITHUB_TOKEN` 由 Actions 自动注入，无需手动配置。

### 分支保护

在 GitHub 仓库 Settings → Branches 中为 `main` 配置：

- **Require status checks to pass** — 勾选 CI 中的全部 Job。
- **Require branches to be up to date** — 合并前必须包含最新代码。
- **Require linear history** — 只允许 rebase / squash merge。
- **Do not allow bypassing the above settings** — 管理员同样受规则约束。

### 本地预检

提交前运行完整检查（与 CI 一致）：

```bash
npm run check
```

等价于：`npm test && npm run typecheck:worker && npm run audit:deps && npm run deploy:dry-run`。

## 运维基线

- 为 5xx、删除失败和异常高的 429 建立告警。
- 每月运行依赖审计，发布前执行 `npm run check`。
- 在 GitHub 启用 Dependabot、Secret scanning、Push protection、CodeQL 和私密漏洞报告；保护 `main` 分支并要求 CI 全部通过。
- 不在日志、错误追踪或客服工单中记录配对码、房间 ID 和访问令牌。
- 出现疑似前端篡改时立即回滚 Worker，暂停服务并轮换 Cloudflare 发布凭据。
- 回滚：在 Cloudflare Dashboard → Workers → instantflow → Deployments 中选择历史版本 Rollback。CI 的 `dist` artifact 可用于手动回滚到任意 commit。
