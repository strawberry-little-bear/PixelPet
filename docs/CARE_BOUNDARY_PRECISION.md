# 照顾门槛的浮点残差一致性

## 本批结论（2026-10-20）

修复一个**精确临界时点**的问题：同一初始状态、同一照顾时间，一次结算与多次读取后，浮点残差可能改变「是否记习惯」或「已经吃饱/洗净」的离散判断。不是普通时刻普遍丢失奖励，也不是调整养成难度。

上批[不规则结算审计](GROWTH_PARTITION_AUDIT.md)对累计数值使用 `1e-8` 容差，没有在终点实际执行临界喂食/洗澡。本批补的是这种数值近似一致、实际操作却可能不同的缺口。

## 真实复现

30 分钟自然衰减，在幼年、成长期、成年分别比较一次结算与 1 秒、15 秒（App 轮询周期）、17.321 秒读取；每段 JSON 持久化后执行正式存档校验，再实际调用照顾规则。

| 应到门槛 | 多次读取的旧实现读数示例 | 旧实现后果 |
|---|---|---|
| 饱食 70 | `70.000000000001364` | 应记喂食习惯，却判为不需要 |
| 清洁 65 | `65.000000000009436` | 应记清洁习惯，却判为不需要 |
| 饱食 96 | `95.999999999999659` | 应拒绝已饱喂食，却接受 |
| 清洁 99 | `98.999999999999204` | 应拒绝已净洗澡，却接受 |

新增分段操作回归在旧实现 **18/36 组失败**；前端新增回归在旧实现 **26 失败/29 原已符合**。证据分别保留于 `/tmp/pet-care-boundary/go-before.log` 与 `frontend-before.log`。

## 修复范围

- 仅在四个照顾门槛的比较中，将距离门槛不超过 `1e-9` 的数视为门槛；可用性、习惯记录和结果原因使用相同判据。
- **不四舍五入或写回需求值**，实际照顾效果及回执仍保留原始小数。喂食/洗澡的每毫秒自然衰减至少约 `5e-7`，明显大于这个残差窗口；窗口外仍按原条件判断。
- 后端 `careRules.needTolerance` 是响应能力元数据，不进入宠物存档，不改变 schema。前端只接受有限且在 `0…1e-9` 内的能力值；旧服务缺字段或字段不合法时保留原精确比较，不承诺新服务规则。
- 预览、基准效果是否展示及「整数显示相同，实际高于/低于」说明同步使用上述能力，避免已经视为门槛却显示相反解释。
- 30 分钟冷却、成长封顶、阶段里程碑和成年冻结依据不变。不改衰减速度、资源、基础照顾增量、睡眠 100 门槛或小游戏条件。
- A/B/C 操作不变，LCD 没有新增可点击控件。

实现：`internal/game/care_rules.go`、`game.go`、`growth.go`、`feedback.go`，及 `web/src/CarePreview.tsx`、`types.ts`。

## 分层验收

### 受控服务端时间：实际边界照顾

- `internal/game/care_partition_test.go`：**160 组**，包含 36 组分段操作、112 组窗口内外及阶段里程碑、12 组冷却恰好到期/差 1 毫秒。三阶段、成长封顶、成年依据、回执原始需求和实际增量均核对；拒绝动作不能修改需求。重复 10 次，共 **1600 组次**通过。
- `internal/store/care_boundary_test.go`：**8 组**，真实临时 SQLite、一次/15 秒读取、关库重开后在同一受控时点照顾。习惯及拒绝结果正确；成功请求同 ID 重试返回回执、不再加成长/习惯/次数；拒绝不改变持久需求或 revision，能力字段不进入 State JSON。
- 这些是合法构造状态与受控时钟，不冒称真人自然连续养育多日。

### 前端与真实 Chrome

- 新增 **55 项**组件测试；全量 **3338 项/129 文件**、TypeScript 和独立前端构建通过。
- 新 `scripts/check-care-boundary.mjs`，独立二进制/前端、随机端口和临时 SQLite：
  - **108 组只读响应夹具**：三阶段×喂食/洗澡×桌面/320px 双倍字号/320px 短屏强制颜色×6 种临界及旧/坏能力情形。从真实读取响应仅改相应需求和可选能力字段，不执行照顾；核对预览、基准增量、整数边界说明、末尾文字可达及无写操作。
  - **18 组真实 HTTP 照顾**：移除所有路由夹具，以需求 30 通过机身键执行两次照顾，首记习惯、第二次处于冷却；刷新后只保留一次习惯与两次照顾，不重放操作、不发币，成年形态依据不变。
  - 两类均检查文字/底栏边界、字号、横向溢出、仅三键、零运行错误；已查看桌面、手机双倍文字及强制颜色截图。
- 真实浏览器无法可靠命中 `1e-9` 门槛：自然请求延迟一个毫秒就已越过窗口。**不将只读浏览器夹具说成真实临界操作证据**；精确边界由上述真实规则/SQLite 受控时钟测试证明。
- 既有照顾菜单阅读 Chrome 15 组交叉回归通过。Go 无缓存全量 race、vet 与独立构建通过，最终测试文件增强后另复跑 game/store 全量 race。

## 安全与复跑

不访问或重启原 `18102` 玩家服务，不修改玩家库、共享 `bin/pixelpet` 或 `web/dist`。最终核对七个玩家/共享文件 SHA256 及 dist 文件列表均不变；新版仅提交推送，**未自动部署到原试玩页面**。

```sh
.tools/go/bin/go test ./internal/game \
  -run '^TestCare(OutcomesIgnoreSettlementPartitionResidue|NumericalBoundaryWindowAndMilestones|NumericalResidueDoesNotBypassCooldown)$' -count=10
.tools/go/bin/go test ./internal/store -run '^TestPersistedCareBoundaryAndReplay$' -count=1
.tools/go/bin/go test -race -count=1 ./...
.tools/go/bin/go vet ./...
# 先将当前二进制和前端构建至独立临时目录，再运行：
PIXELPET_TEST_BINARY=/absolute/tmp/pixelpet \
PIXELPET_TEST_WEB=/absolute/tmp/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-care-boundary.mjs
```

本批日志、独立构建在 `/tmp/pet-care-boundary/`；Chrome 产物路径写在 `browser.log`、`browser-menu-reading.log` 末尾。自动化不等于实体手机、其他浏览器、真人读屏或长玩舒适度验证。下一批仍优先可复现的照顾、成长、离开恢复问题，保留持续完善目标，不扩张每日资源或打卡负担。
