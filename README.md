# UMA Voting Demo

这是一个基于 `React + TypeScript + Vite` 的 UMA 投票演示项目，用于连接浏览器钱包并在 `Base Sepolia` 网络上体验 UMA 相关交互。

## 环境要求

- Node.js 18 及以上
- Yarn 1.x（项目当前声明为 `yarn@1.22.22`）
- 已安装浏览器钱包，例如 MetaMask、Rabby、OKX Wallet

## 安装依赖

在项目根目录执行：

```bash
yarn install
```

## 启动开发环境

执行：

```bash
yarn dev
```

启动后，Vite 默认会输出本地访问地址，通常是：

```text
http://localhost:5173
```

如果该端口被占用，Vite 会自动切换到其他端口，请以终端实际输出为准。

## 使用说明

1. 打开浏览器访问本地地址。
2. 连接已安装的钱包。
3. 将钱包网络切换到 `Base Sepolia`。
4. 按页面提示进行质押、提案或投票相关操作。

项目内已经写死了 UMA 相关的测试网合约地址与 RPC：

- Network: `Base Sepolia`
- RPC: `https://sepolia.base.org`
- Chain ID: `84532`

当前项目不依赖本地 `.env` 才能启动。

## 构建生产包

执行：

```bash
yarn build
```

构建产物会输出到：

```text
dist/
```

## 本地预览生产构建

先构建，再执行：

```bash
yarn preview
```

## GitHub Pages 构建

如果要按 GitHub Pages 的路径规则构建，可以执行：

```bash
yarn build:pages
```

这个命令会根据仓库名自动设置 Vite 的 `base` 路径。
