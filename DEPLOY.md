# 部署到 GitHub Pages

站点已经在 `site/` 里生成好了（21 个文件，约 450 KB），是**纯静态**的：没有后端、没有构建步骤、没有依赖安装。

```
site/
├─ index.html                主界面（hash 路由：#image / #music / #doc / #wenku / #settings）
├─ manifest.webmanifest      PWA 清单（可安装到桌面/主屏）
├─ sw.js                     离线缓存
├─ 404.html
├─ .nojekyll                 让 Pages 原样发布（不跑 Jekyll）
├─ assets/                   style.css · 9 个 js · 3 个图标
└─ tools/
   ├─ guide.html             使用向导
   └─ wenku_bookmarklet.html 书签生成页
```

---

## 方式 A：网页上传（不用装任何东西）

1. 登录 GitHub → 右上角 **+** → **New repository**
   - Repository name：`fanshi`
   - 选 **Public**（Pages 免费版需要公开仓库）
   - 不要勾 "Add a README file"
   - **Create repository**

2. 仓库页点 **uploading an existing file**（或地址栏加 `/upload/main`）

3. 把 `site/` **里面的内容**（不是 `site` 文件夹本身）拖进上传框：
   - `index.html`、`manifest.webmanifest`、`sw.js`、`404.html`
   - `assets/`、`tools/`
   - `.nojekyll`、`.gitignore`

   > 隐藏文件 `.nojekyll` 在资源管理器里默认看不见。先在「查看 → 显示 → 隐藏的项目」里打开，或上传完用 **Add file → Create new file**，文件名填 `.nojekyll`，内容留空，提交。

4. 下方 **Commit changes**

5. 仓库 **Settings → Pages**
   - Source：**Deploy from a branch**
   - Branch：`main`，目录 `/ (root)`
   - **Save**

6. 等 1–2 分钟，访问 `https://<你的用户名>.github.io/fanshi/`

---

## 方式 B：git 命令行

本机需要先装 Git：[git-scm.com/download/win](https://git-scm.com/download/win)

```bash
cd site
git init
git add -A
git commit -m "feat: 泛式 · 格式转换工作台"

# 把下面地址换成你自己的仓库
git remote add origin https://github.com/<用户名>/fanshi.git
git branch -M main
git push -u origin main
```

然后在仓库 **Settings → Pages** 里把 Source 设为 `main` / `/ (root)`。

> 如果 `.nojekyll` 没被提交进去，Pages 会跑 Jekyll 而忽略以下划线开头的文件。检查：`git ls-files | grep nojekyll`

---

## 方式 C：GitHub Actions（改一次推一次自动发布）

在**主开发仓库**里加 `.github/workflows/pages.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: 生成静态站点
        run: python tools/build_site.py
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

仓库 **Settings → Pages → Source** 选 **GitHub Actions**，之后每次 push 到 `main` 自动重建并发布。

---

## 部署后检查清单

- [ ] 打开首页，五个视图都能切换（`#image` / `#music` / `#doc` / `#wenku` / `#settings`）
- [ ] 拖一张图片进去转 PNG，能下载
- [ ] 拖一个 `.docx` 进「文档转换 → Word → PDF」，能出 PDF
- [ ] `#wenku` 页右上角显示「在线版 · 无本地代理」，预览区给出书签与粘贴两条路
- [ ] 手机浏览器打开，菜单里出现「添加到主屏幕」（PWA 清单生效）

如果样式全丢、控制台报 404，多半是上传时把 `site/` 文件夹整个传了 —— 仓库根应该是 `index.html` 所在的那一层。

---

## 在线版与桌面版的差别

| 能力 | 在线版（GitHub Pages） | 桌面版（本机） |
|---|---|---|
| 图片 / 音频 / Word / PDF 转换 | ✅ 全部可用 | ✅ |
| 音频 NCM 解密、OGG(Opus) 编码 | ✅ 浏览器原生能力 | ✅ |
| 离线打开 | ✅ Service Worker 缓存 | ✅ |
| 文库直接抓取（填 URL 就抓） | ❌ 同源策略限制 | ✅ 带本机转发层 |
| 文库内容获取 | ✅ 书签 / 粘贴正文 | ✅ 全部路径 |
| Windows 信任证书、Defender 排除 | — | ✅ `tools\trust_setup.ps1` |

纯静态站点在浏览器里没有转发层，跨站抓取是**同源策略**决定的，不是权限问题 —— 任何在线版都绕不过，所以在线版把这条路换成了书签（在目标页面执行，不受限制）与粘贴正文。

---

## 自定义域名（可选）

1. 仓库 **Settings → Pages → Custom domain** 填域名
2. 在你域名的 DNS 里加一条 `CNAME` 记录指向 `<用户名>.github.io`
3. 勾选 **Enforce HTTPS**（证书由 GitHub 自动签发）

用自定义域名时，HTTPS 证书由 GitHub 提供，不需要再跑本项目的 `trust_setup.ps1`。

---

## 想同时保留桌面版

桌面版多出来的能力（本机转发层、证书信任、命令行工具）都在仓库根目录，不进 `site/`：

```bat
start.cmd            :: 本地服务 + 界面（http://localhost:8787）
爬取.cmd             :: 复制链接后双击，一键抓取
tools\guide.html     :: 使用向导
```

两者可以共存：在线版给手机和别人用，桌面版自己在本机抓取。

---

## 方式 D：一条命令（不用装 git）

准备好一个 GitHub Token，然后：

```powershell
powershell -ExecutionPolicy Bypass -File tools\publish_github.ps1 -Token ghp_你的token
```

脚本会依次完成：校验身份 → 建仓库（已存在则复用）→ 用 Git Data API **一次提交**全部 21 个文件 → 建 `main` 分支 → 开启 Pages → 打印站点地址。

### 怎么拿 Token（30 秒）

1. GitHub 右上角头像 → **Settings**
2. 左栏最下 **Developer settings**
3. **Personal access tokens → Tokens (classic)**
4. **Generate new token (classic)**
   - Note：`fanshi`
   - Expiration：`30 days`（或自定义）
   - 勾选 **`repo`**（整块，包含下面的子项）
5. **Generate token** → 复制 `ghp_` 开头那串（只显示一次）

> 用 fine-grained token 也可以，但权限要手动勾：`Contents: Read and write`、`Administration: Read and write`、`Pages: Read and write`、`Metadata: Read`。classic 的 `repo` 更省事。

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `-Token` | 必填 | `ghp_...` |
| `-Repo` | `fanshi` | 仓库名 |
| `-Private` | 关 | 加这个开关建成私有仓库（Pages 需要 Pro 才能私有发布） |
| `-Source` | `site` | 发布目录；想发布整个项目就传 `.` |
| `-SkipPages` | 关 | 只推代码，不动 Pages 设置 |

### 更新已发布的站点

```powershell
python tools\build_site.py
powershell -ExecutionPolicy Bypass -File tools\publish_github.ps1 -Token ghp_你的token
```

脚本检测到 `main` 已存在，会以当前 HEAD 为父提交做增量覆盖，**不会**清掉历史。

### 验证过的部分

用无效 token 跑过一遍，能正确停在校验环节并给出明确错误：

```
» 校验 Token
GitHub API GET /user 失败
  HTTP 401
  { "message": "Bad credentials", ... }
```

网络链路（代理 → api.github.com）也是通的，返回 200。
