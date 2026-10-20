# 商店分类数量不拆行（2026-10-20）

## 已复现的问题

320px 视口、根字号28px（默认14px的200%）时，商店分类仍为固定两列。行内 flex 压缩右侧数量，全局任意断行使 `+10` 分成三行、`12` 分成两行。服务端数量没有出错，但很容易读错。

这与上一批[预览说明覆盖分类](DAILY_REFRESH.md)是两个问题：上一批让预览说明参与自然排版，本批处理分类自身的数字断行；不能把既有裁切验收通过当作数量完整可读。

## 修复范围

- 分类列宽使用基于 rem 的自适应网格：普通桌面保留两列，窄屏或大字下自然变为单列，不缩小字体、不省略内容。
- 右侧金额和单位不压缩、不换行；分类名称仍可折行。问候显示 `+10 币`，其余分类显示实际目录/拥有数量，例如 `12 件`、`0 件`。
- 数量继续来自当前服务规则和权威所有权。只预览、打开购买确认不会增加拥有数量；实际购买后的新状态才更新。
- 不改价格、奖励、每日额度、存档schema、旧档迁移或成长规则；分类顺序、稳定ID、确认流程、仅A/B/C三键保持不变。

## 回归范围

- 新增12项组件测试：七种分类选中状态、预览/确认/权威购买状态、零数量、自定义问候金额、旧服务缺钱包上限、缺规则/经济数据、不修改输入及不新增点击控件。旧实现10项失败，2项原本符合。
- 增强真实HTTP/SQLite/Chrome脚本 `scripts/check-shop-reading.mjs`：用文本Range验证数量只有一行、未裁切，金额/件数单位正确且字号未缩小；大字目录验证单列。
- 既有27组矩阵（三阶段 × 有币/无币/睡眠 × 桌面正常字/320px双倍字/320px短屏双倍字）保留，再加320px和390px正常字各一组幼年有币烟雾测试，共29组。
- 有币11组在独立临时存档实际购买一次、穿戴、收起、刷新，再进“已拥有”确认 `1 件`；只读预览和读取不发经济写入，刷新不重放。初始钱包与拥有状态为构造夹具，不冒称自然赚币。
- 数字行数检查与既有文字边界、底栏、主动操作定位、普通同步不抢滚动/焦点、三键、零运行错误检查共同执行。390px是窄视口烟雾测试，不是实体手机认证；此批也不代表所有页面数字展示已审计。

## 最终结果

全量前端 **3390项/131文件**、TypeScript与独立Vite构建、Go无缓存全量race/vet/独立构建通过。商店 **29组** 和既有本地刷新说明 **54组** 真实HTTP/SQLite/Chrome交叉回归全部通过。已查看最终桌面、320px双倍字号/短屏、320px与390px正常字目录截图。

旧构建的新增浏览器断言先复现 `+10` 三行、`12` 两行；最终数量完整一行，不借缩字过关。浏览器产物分别为 `pixelpet-shop-reading-idha33` 与 `pixelpet-daily-refresh-UrATuc`（路径由日志记录）。

## 独立复跑

Node加入PATH后：

```sh
cd web
./node_modules/.bin/vitest run --maxWorkers=4
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build --outDir /tmp/pet-shop-quantities/web
cd ..
.tools/go/bin/go test -count=1 -race ./...
.tools/go/bin/go vet ./...
.tools/go/bin/go build -o /tmp/pet-shop-quantities/pixelpet ./cmd/pet
PIXELPET_TEST_BINARY=/tmp/pet-shop-quantities/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-shop-quantities/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-shop-reading.mjs
# 同一独立构建交叉回归本地刷新说明：
PIXELPET_TEST_BINARY=/tmp/pet-shop-quantities/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-shop-quantities/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-daily-refresh.mjs
```

日志和独立构建：`/tmp/pet-shop-quantities/`。脚本自建临时数据库、随机测试端口，不访问或部署玩家18102服务，不改玩家库或共享bin/dist。
