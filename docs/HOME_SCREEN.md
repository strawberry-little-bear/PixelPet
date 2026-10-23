# 添加到主屏幕与独立窗口

[项目首页](../README.md) · [文档导航](README.md) · [开发与运行](DEVELOPMENT.md)

PixelPet 提供应用清单和主屏幕图标，支持的浏览器可把同一个游戏地址保存为主屏幕入口或独立窗口。打开后仍然连接 Go 服务，存档继续保存在该服务的 SQLite 数据库中。

## 怎么使用

先按[快速开始](../README.md#快速开始)启动服务，在浏览器确认游戏可以正常打开，再使用浏览器提供的安装／添加到主屏幕入口。入口名称和位置随系统、浏览器版本而异；Safari 的主屏幕入口通常位于分享菜单，桌面 Chrome、Edge 可查看地址栏或浏览器菜单中的安装选项。

- 安装入口保存的是当时访问的地址。服务重启后保持原地址即可继续；改变主机或端口时，需要从新地址重新添加。
- `127.0.0.1` 和 `localhost` 指当前使用浏览器的设备。电脑上的 `http://127.0.0.1:8080` 不能直接作为手机访问电脑服务的地址。
- 浏览器对安装的安全上下文要求与普通网页访问不同。电脑上的 localhost 可用于本地安装验证；通过局域网 HTTP 地址能打开网页，不保证浏览器会提供完整的应用安装入口。请按浏览器实际提示操作。
- 桌面浏览器和主屏幕窗口连接同一服务时共用服务端存档。偏好设置保存在各自的浏览器环境中，安装不等于同步这些设置。

当前没有离线网页缓存或离线写入队列。服务关闭、设备无法连接服务或地址失效时，主屏幕图标不会代替服务继续运行。恢复连接后按页面提示核对保存状态；安装也不会把电脑存档复制到手机或云端。服务的本地单玩家限制仍见[运行说明](DEVELOPMENT.md#服务配置)。

## 图标资源

| 使用位置 | 资源 | 说明 |
| --- | --- | --- |
| 浏览器标签及支持 SVG 的应用入口 | `web/public/favicon.svg` | 原有品牌图标 |
| 应用清单 | `web/public/icons/icon-192.png`、`icon-512.png` | 192×192、512×512，`purpose: any` |
| Apple 主屏幕入口 | `web/public/icons/apple-touch-icon.png` | 180×180，在 HTML 中单独链接 |

PNG 沿用 SVG 中的角色轮廓、眼睛和配色，背景填满方形，由系统处理圆角；未把普通图标标为 maskable。资源随前端构建发布，使用现有静态服务的 `no-cache` 重验证策略。

需要更新图标时，先编辑 SVG，再在有 Playwright 和 Chrome 的开发环境运行：

```sh
# 可选工具，不属于日常安装／构建依赖；路径指向本机 Playwright 入口。
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/generate-home-screen-icons.mjs
```

提交生成后的三张 PNG。普通 `pnpm build` 直接复制已有资源，不会启动浏览器或重新生成图标。

## 本轮验证范围

`node scripts/check-home-screen.mjs` 使用[隔离构建](DEVELOPMENT.md#验证与隔离构建)及 `PIXELPET_TEST_BINARY`、`PIXELPET_TEST_WEB`、`PIXELPET_PLAYWRIGHT_MODULE`，创建临时数据库、随机端口和独立 Chrome 配置目录，检查：

- 真实浏览器解析清单，无解析错误；启动地址和 scope 保持当前服务根路径。
- 清单链接两种 PNG，HTML 链接 Apple 图标；实际 HTTP 返回类型正确，图片可解码、尺寸正确、全图不透明。
- 清单和图标支持条件请求返回 304，保持重验证；HTML 保持 `no-store`。
- Chrome 安装性诊断无错误；刷新后游戏可打开，机身保持三键，LCD 无新增操作控件，无额外玩法写请求。

修前 Chrome 154 已能接受 SVG 清单，诊断同样无错误；本轮补齐的是 PNG 与 Apple 图标覆盖，不将它记作已复现的 Chrome 安装故障。修前同一回归在缺少 Apple 图标链接处失败。

这些检查没有执行操作系统安装，也不代表 iPhone、Android 实机或离线游戏验收。主屏幕图标在实际系统中的裁切、独立窗口恢复和服务暂不可用后的体验仍需实机试玩。

参考：[Chrome 应用清单安装检查](https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest)、[Apple Web Clip 图标说明](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)。具体安装行为以当前系统和浏览器为准。
