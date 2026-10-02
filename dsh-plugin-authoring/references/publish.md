# 发布手册（GitHub + npm）

## 0. 先决条件

- 仓库根 = 包根（`package.json` 在第一层）。
- `package.json` 里已填 `repository` / `homepage` / `bugs` / `author` / `keywords` / `engines`。
- 工作区干净：`git status --short` 为空；`node --test test/verify.mjs` 全绿。

## 1. GitHub（走 REST API，避开时通时断的 github.com）

```sh
# 先干跑看清要发什么
node tools/publish-to-github.mjs --dry-run

# 真发布（PAT 需要 repo + workflow 两个 scope；workflow 是仓库里有 .github/workflows/* 的硬要求）
GH_TOKEN=<PAT> node tools/publish-to-github.mjs

# 顺带打 tag + 建 Release（正文取 CHANGELOG 里对应版本那一段）
GH_TOKEN=<PAT> node tools/publish-to-github.mjs --release

# tag 已存在但指向旧提交时挪过来
GH_TOKEN=<PAT> node tools/publish-to-github.mjs --release --force-tag
```

脚本会：`POST /user/repos`（已存在就复用）→ 空仓库先用 Contents API 引导（**踩坑 F1**）→ 逐文件建 blob → 建 tree（带 `base_tree`）→ 建 commit → `PATCH refs/heads/<default>` → `PUT /topics` →（可选）打 tag、建 Release。

**为什么要用脚本而不是 `git push`**：本机 `github.com`（网页/OAuth）经常超时，而 `api.github.com` 稳定（**踩坑 F2**）；`gh auth login` 的设备码流程因此永远走不完，只能用 PAT 走 API。

排错：
- `403` + `workflow` 字样 → PAT 少 `workflow` scope。
- `409 Git Repository is empty` → 走到了没有引导逻辑的旧版本脚本，或手工调 blobs。
- `422`（建仓库）→ 仓库已存在，属正常复用分支。

## 2. npm

```sh
npm login            # 浏览器流程，一次性
npm publish          # 若账号 2FA = auth-and-writes：需要 OTP 或 bypass-2FA 令牌
```

### 2FA 的两种活法（**踩坑 F4**）

- **OTP**：`npm publish --otp=<6 位>`，码来自当初绑定的验证器 App（npm 网站里没有"显示验证码"入口）。注意**系统时钟偏差会让 TOTP 被判失效**（实测本机快 14 秒就连续失败）：先对齐时间（系统设置里开关一次自动校时，或 `sudo sntp -sS time.apple.com`）。
- **bypass-2FA 的 Granular Access Token（推荐）**：npm → Access Tokens → Generate New Token → Granular Access Token →
  - ☑ Bypass two-factor authentication
  - Permissions: **Read and write (publish and stage)**
  - Select packages: **All packages** ← **首次发布新包必须这样选**，因为包在 npm 上还不存在，选不了具体包；上架之后再回来收窄成"仅选定包"
  - Allowed IP ranges 留空（出口 IP 会变）
  - Expiration 拉到最长
  然后 `npm config set //registry.npmjs.org/:_authToken=<token>`，之后 `npm publish` 不再要 OTP。
  （npm 公告：2027-01 起移除 bypass-2FA 令牌直接发布的能力，届时迁到 stage-only 或 Trusted Publishing。）

### 发布后

- **有传播延迟**：日志会写 `Your package is being processed`；实测前 40 秒 registry 还是旧版本，第 60 秒才出现新版本（**踩坑 F5**）。轮询确认：
  ```sh
  curl -s https://registry.npmjs.org/<pkg> | python3 -c "import json,sys;print(json.load(sys.stdin)['dist-tags'])"
  ```
- 版本号只能往上加；`npm publish` 前先改 `package.json.version` 并在 CHANGELOG 里写对应段落（Release 正文就取这一段）。

## 3. 发完必做的验收

```sh
# 别人会用的那条命令，在临时目录真装一次
mkdir -p /tmp/verify-install && cd /tmp/verify-install && npm init -y
pnpm add <pkg>@<version>          # 或不钉版本：pnpm add <pkg>
ls node_modules/<pkg>             # package.json lib locale icon.svg cordis.patch.yml 齐全

# DSH 侧真实安装（可选，但最接近用户）
dsh plugin --profile web add <pkg>        # 或 github:<user>/<repo>
# 装完刷新页面；卸载：dsh plugin --profile web remove <pkg>
```

最后核对：registry 的 `dist-tags.latest`、GitHub 的 CI 状态、Release 是否指向最新提交。

## 4. 关于 pnpm 的 24 小时门槛

不需要担心：pnpm 11 对**首次添加**的依赖会自动把该版本写进 profile 的 `minimumReleaseAgeExclude` 并安装（**踩坑 E3**）。只有显式开启 `minimumReleaseAgeStrict` 才会拦，那时钉版本即可。
