# 项目协作规则

## Git 提交身份

- 本项目的提交作者（author）和提交者（committer）都必须是 **草莓小熊**。
- 邮箱使用 `182593643+strawberry-little-bear@users.noreply.github.com`。
- 不要使用电脑全局配置中的 `xjx` 身份，也不要为本项目修改全局 Git 配置。
- 提交前执行 `git var GIT_AUTHOR_IDENT`、`git var GIT_COMMITTER_IDENT` 核对实际生效身份；提交后执行 `git log -1 --format=fuller` 再确认。
- 未获明确授权不推送，不重写历史提交。

## 游戏开发约束

- 玩法仅使用 A / B / C 三键；屏幕不新增可点击的玩法控件。
- 测试使用独立临时数据库，不重置或导入覆盖 `data/pixelpet.db` 玩家存档。
- 保持旧存档兼容，测试通过后再提交；如只完成一部分，明确说明剩余工作。
