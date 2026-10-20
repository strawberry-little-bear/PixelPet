# 小窝三阶段安稳对白

## 内容与边界

十只宠物各有幼年、成长、成年三个已保存阶段的「现在很舒适」和「想安静陪伴」短句，共60句。措辞对应既有尾巴、翅膀、鳍、菌盖等角色造型，只描述此刻陪伴，不编造昨天或上次的经历，不催促回访、成长或打卡。这是静态内容增强，不是新事件、照顾奖励或新造型。

- `homeVoice` 只接受有效角色、记录中的 baby/growing/adult 和 content/quiet；缺失成长记录、蛋或非法参数返回 null，沿用原需求文案，不按年龄或形态推断。
- `petNeed` 仅替换最终平静文案；饥饿、疲倦、脏污、陪玩邀请、紧急阈值与顺序不变。睡眠、未孵化和游戏中不显示此类需求。
- 不改变短暂照顾反馈和游戏回窝回应的优先级、生命周期，不作为新的 aria 状态事件。真实喂食保存后的习惯反馈先显示，再回到安稳短句。
- 仍使用现有 A/B/C 与需求姿态，LCD 不增按钮；没有新增请求、随机、计时器、成长规则、金币、schema 或历史记录。

## 验证

- 新增72项纯逻辑、62项真实App回归；鸟类原需求测试更新平静阶段预期，仍保留身体需求与旧档回退检查。接入前纯逻辑71项中40失败/31通过，接入后及补充边界通过；旧独立前端浏览器构建首组精确台词断言失败。
- 最终前端全量 **3923项 / 147文件** 通过，TypeScript、独立Vite构建及 Go 无缓存 race、vet、独立构建通过。App断言检查实际 `.care-outcome`、`data-echo` 和 `data-motion`，不使用不存在的事件覆盖层选择器。
- 新 Chrome **126组** 通过：十角色×三阶段×两心情×两视口=120组，加三阶段×两视口的真实喂食/反馈释放/睡眠/游戏抑制6组。验证精确台词、三键菜单往返、显式可见性同步、刷新、不额外写动作、不改习惯/物品/日志/形态，以及文本边界、底栏遮挡、滚动祖先裁切和横向溢出。
- 既有 `check-home-echo-clock.mjs` 另跑12组通过，真实等待结算与回应期限、浏览器时钟前后跳变、不重播及需求优先保持。产物目录 `pixelpet-home-echo-clock-52zWsF`，日志 `/tmp/pet-home-voice/echo-clock.log`。
- 桌面1200px；手机320px、根字号从14px加到28px、强制颜色；均减少动态。已实际查看桌面幼年/成年兔、手机成长兔、幼年鸟和成年海豚截图，文字可读、三键保留。

浏览器使用随机端口、自建临时SQLite和独立构建，不访问玩家18102。三阶段由旧schema导入、受控年龄迁移得到，不代表自然多日养成；喂食为真实HTTP与机身按键，入睡/叫醒/开局为明确的隔离夹具，不冒称真人或实体手机体验。

本批日志与构建：`/tmp/pet-home-voice/`；126组浏览器截图及结果：系统临时目录 `pixelpet-home-voice-MbSaPX`。复跑：

```sh
.tools/go/bin/go build -o /tmp/pet-home-voice/pixelpet ./cmd/pet
(cd web && ./node_modules/.bin/vite build --outDir /tmp/pet-home-voice/web)
PIXELPET_TEST_BINARY=/tmp/pet-home-voice/pixelpet \
PIXELPET_TEST_WEB=/tmp/pet-home-voice/web \
PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node scripts/check-home-voice.mjs
```

需要支持直接导入TypeScript的Node（本批Node24）、Playwright与Chrome；脚本拒绝共享bin/dist及其符号链接别名，不接受外部服务URL或数据库路径。玩家数据库、共享二进制和共享前端产物保持原样，没有自动部署。
