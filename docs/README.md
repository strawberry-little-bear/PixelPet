# PixelPet 文档导航

[返回项目首页](../README.md)

首页面向第一次来玩的读者；这里收录玩法、开发和专项验证。**历史文档保留当时范围，可能写着“六款游戏”或“候选未实现”；当前正式菜单为七款，节奏拍手仍是独立实验。** 最新状态优先看试玩反馈索引、进度与下一步计划。

## 从这里开始

| 需要 | 文档 |
| --- | --- |
| 安装、启动、服务配置、隔离测试 | [开发与运行](DEVELOPMENT.md) |
| 添加到主屏幕、图标与连接条件 | [主屏幕与独立窗口](HOME_SCREEN.md) |
| 十只原创角色、阶段造型与动作截图 | [角色图集](CHARACTERS.md) |
| 已处理的试玩建议及当前状态 | [试玩反馈](PLAYTEST_FEEDBACK.md) |
| **交开发者的评审（问题分级 + 证据 + 复现）** | [评审 2026-10-26](review-2026-10-26/README.md) |
| 最新一轮从孵化玩到寻宝的完整记录 | [试玩记录 2026-10-26](PLAYTEST_2026-10-26.md) |
| 上一轮试玩记录 | [试玩记录 2026-10-22](PLAYTEST_2026-10-22.md) |
| 下一批优先做什么 | [下一步计划](NEXT_STEPS.md) |
| 已有交付与历史验收 | [开发进度](PROGRESS.md) · [原计划归档](NEXT_STEPS_HISTORY_2026-10-21.md) |
| 总体路线与早期规划 | [路线图](ROADMAP.md) · [非小游戏完善计划](IMPROVEMENT_PLAN.md) |
| 如何提供有用的试玩反馈 | [试玩记录与反馈问题](PLAYTEST.md) |

## 玩法与内容

### 成长与照顾

- [成长手册、阈值与成年形态](GROWTH.md)（A 上一页／B 下一页）
- [照顾指南](CARE_GUIDE.md) · [宠物照顾说明](PET_CARE_GUIDE.md)
- [小窝阶段对白与成年陪伴风格](HOME_STAGE_VOICE.md)
- [共同游戏记录与有限兴趣](COMPANION.md)
- [金币、每日问候与小窝商店](ECONOMY.md)
- [永久纪念册分类浏览](ALBUM_BROWSING.md) · [成长日记阅读](JOURNAL_READING.md)
- [睡饱后的永久纪念](RESTED_MEMORY.md) · [游戏小纪念物](GAME_KEEPSAKES.md)
- [照顾结果留在近期日记](CARE_DIARY.md) · [睡眠小结与起床日记](SLEEP_SUMMARY.md)

### 七款正式小游戏

- [统一入口、接星星及七款说明／奖励条件](ARCADE.md)
- [连连看及大字号选牌反馈](TILE_MATCH.md) · [贪吃蛇](SNAKE.md) · [俄罗斯方块](TETRIS.md)
- [池塘钓鱼、鱼图鉴与本局钓获回看](FISHING.md) · [公园散步、沿途发现与本局回看](WALK.md)
- [森林寻宝规则](TREASURE_RULES.md) · [寻宝小屏可见性](TREASURE_VIEWPORT.md) · [寻宝同步验收](TREASURE_SYNC.md)
- [暂停中重看规则](PAUSE_GUIDE.md) · [重复进入的简洁开始卡](ARCADE.md#已交付更新于2026-10-20)

### 风景、发现与对白

- [钓鱼等待反馈](FISHING_ATMOSPHERE.md)
- [虚构风景与季节／晨昏对白](OUTING_DIALOGUE.md) · [永久风景手记](OUTING_MEMORIES.md)
- [两种偶遇手记](OUTING_ENCOUNTERS.md) · [虚构雨景中的雨珠小鲤](RAIN_FISH.md)

## 离开、备份与恢复

- [回访两页三键导航](RETURN_NAVIGATION.md) · [固定 LCD 与内部滚动](RETURN_LAYOUT.md)
- [离开期间累计结算与单次上限](RETURN_SETTLEMENT.md)
- [回访历史睡眠状态](RETURN_SLEEP.md) · [回访后的当前照顾建议](RETURN_CARE.md)
- [回访响应保护](RETURN_RESPONSE_SAFETY.md) · [起止顺序校验](RETURN_PERIOD_VALIDATION.md) · [回访外层阅读视口](RETURN_READING_VIEWPORT.md)
- [JSON 备份预览与确认](BACKUP_CONFIRMATION.md) · [存档盒自动恢复点](RECOVERY_POINTS.md) · [损坏存档修复](CORRUPT_SAVE_RECOVERY.md)
- [存档盒运行信息与构建版本](RUNTIME_INFO.md)
- [连接／保存结果核对](SAVE_RECOVERY.md) · [恢复提示不遮挡阅读](RECOVERY_NOTICE_READING.md) · [多页面存档同步](SAVE_SYNC.md)
- [时间倒退保护](CLOCK_RECOVERY.md) · [基础响应保护](RESPONSE_CORE_GUARD.md)
- [成长响应保护](GROWTH_RESPONSE_GUARD.md) · [多页面睡眠意图保护](SLEEP_INTENT.md)

## 成长与照顾的显示细节

这些是规则解释与专项回归，不代表每篇都新增一套玩法。

| 主题 | 专项说明 |
| --- | --- |
| 当前状态与时间 | [状态读数时间](STATUS_READING_TIME.md) · [显示时钟同步](APP_CLOCK_SYNC.md) · [此刻状态与成长参考](GROWTH_SNAPSHOT.md) |
| 照顾前提示 | [小窝／菜单建议](CARE_MENU_ADVICE.md) · [效果与习惯条件](CARE_PREVIEW.md) · [服务端数值基准](CARE_BASE_EFFECT.md) · [整数边界读数](CARE_ROUNDING.md) |
| 照顾后结果 | [即时成长／习惯回执](CARE_LEARNING_RECEIPT.md) · [反馈阅读时长](CARE_FEEDBACK_READING.md) · [反馈显示保护](CARE_FEEDBACK_SAFETY.md) · [回执与日记精度一致](CARE_AMOUNT_PRECISION.md) |
| 睡眠中的照顾 | [主页／醒来照顾指引](SLEEP_CARE_GUIDANCE.md) · [本段休息进度](SLEEP_PROGRESS.md) |
| 自然与休息成长 | [成长基准](GROWTH_BASIS.md) · [睡眠菜单基准](SLEEP_BASIS.md) · [睡眠确认提示](SLEEP_FEEDBACK_BASIS.md) |
| 习惯与成年定型 | [微量习惯读数](HABIT_PRECISION.md) · [形态条件核对](FORM_CONDITIONS.md) · [永久定型依据](FORM_RECORD.md) |
| 角色需求 | [鸟类翅膀／理羽表达](BIRD_NEED_CUES.md) · [三阶段外观说明](STAGE_LOOK_GUIDE.md) |

## 三键、阅读与无障碍

- [三键阅读可达性与首次迎接字号](READING_ACCESSIBILITY.md) · [键盘输入安全](KEYBOARD_SAFETY.md)
- [阅读页成功通知不遮字／按键](READING_NOTICES.md)
- [物理键盘与网络等待焦点](PHYSICAL_KEYBOARD.md) · [可选提示音容错](AUDIO_SAFETY.md)
- [窗口失焦暂停](WINDOW_PAUSE.md) · [回窗同步](WINDOW_RETURN_SYNC.md)
- [蛇／方块自动节拍中 C 暂停](BOARD_PULSE_PAUSE.md)
- [散步自动前进中 C 暂停](WALK.md#2026-10-21--自动前进时也能按-c-暂停)
- [长名字换行布局](NAME_LAYOUT.md) · [大字号图鉴阅读](COLLECTION_READING_VIEWPORT.md)
- [成长／状态阅读视口](CARE_READING_VIEWPORT.md) · [暂停页阅读视口](PAUSE_READING_VIEWPORT.md)
- [钓鱼暂停菜单大字号布局](FISHING_PAUSE_LAYOUT.md)

## 跨系统验证与实验边界

- [稳定运行时分包、静态缓存与更新验证](BUILD_CACHE.md)
- [从新蛋到成年的受控存储层旅程](GROWTH_JOURNEYS.md)
- [四种照顾策略的受控 HTTP 旅程](HTTP_GROWTH_JOURNEYS.md)
- [照顾跨阶段、刷新与恢复的浏览器旅程](CARE_GROWTH_JOURNEY.md)
- [真实停服与短时离线结算验收](OFFLINE_WALLCLOCK.md)
- [节奏拍手独立原型与运行说明](../prototypes/rhythm/README.md) · [节奏公平性评估](RHYTHM_EVALUATION.md)

这些记录各自说明测试存档、时钟、模拟条件和未覆盖项；不能用受控旅程、模拟手机视口或自动化通过替代自然多日养成、实体设备、真人读屏或长玩舒适度反馈。浏览器验收必须使用独立临时库和构建，见[开发说明](DEVELOPMENT.md#验证与隔离构建)。

其他专题文档与验证截图保留在本目录，不再逐批追加到项目首页。
