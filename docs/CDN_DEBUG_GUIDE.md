# CDN 数据对齐调试指南

## 一、数据流全景

```
Leiting CDN (shijtswydl.leiting.com)
    │
    │  wfax fetch (Go 工具)
    ▼
  dump/  原始有序映射二进制（ZIP 压缩）
    │
    │  wfax extract
    ▼
  wf-assets-cn/orderedmap/  2115 个 JSON 文件（标准答案）
    │
    │  converter.py (starpoint-cn/scripts/)
    ▼
  starpoint-cn/assets/  服务端使用的 JSON 文件
    │
    │  TypeScript 静态 import
    ▼
  服务端运行时 (Fastify)
    │
    │  HTTP API (MsgPack → Base64)
    ▼
  客户端 (CN Android APK)
    │
    │  客户端本地 CDN 表 (orderedmap)
    ▼
  UI 显示 (报酬一览、掉落画面)
```

### 关键原则

**`wf-assets-cn/orderedmap/` 是标准答案。** 服务端 `assets/` 中的 JSON 是转换脚本的产物。两者不一致 → 转换脚本有 bug。

---

## 二、工具链

### 2.1 wfax — CDN 下载/提取

| 命令 | 用途 |
|------|------|
| `wfax fetch dump --region cn` | 从 Leiting CDN 下载完整有序映射 |
| `wfax extract dump --indent 2 ./output` | 解压为 JSON → `output/orderedmap/` |
| `wfax extract dump --path-list .pathlist` | 仅提取指定路径的表 |

**安装**：`go install github.com/blead/wfax@latest`

**本地 CDN 镜像**（无需联网）：
```bash
wfax fetch dump \
  --custom-api "file:///path/to/entities/10939-android_medium.csv" \
  --custom-cdn "file:///path/to/cn_cdn_new/WF__CN2/" \
  --version 1.4.54
```

**路径**：`<PII_REMOVED>/Documents/ProjectFolder/worldflipper/cdn/cn_cdn_new/WF__CN2/`

### 2.2 converter.py — JSON 格式转换

**位置**：`starpoint-cn/scripts/converter.py`

**输入**：`scripts/in/<name>.json`（需从 `wf-assets-cn/orderedmap/` 复制）
**输出**：`scripts/out/<name>.json`（需复制到 `assets/`）

**执行**：
```bash
cd starpoint-cn/scripts
cp ../../wf-assets-cn/orderedmap/reward/rare_score_reward.json in/
python3 converter.py
cp out/rare_score_reward.json ../assets/
```

### 2.3 ADB — 客户端数据提取

```bash
# 连接设备
adb connect <ip>:5667

# 计算文件 SHA1
echo -n "master/reward/rare_score_reward.orderedmapK6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy" | shasum -a 1

# 提取文件
adb pull "/data/data/com.leiting.wf/.../Local Store/asset/asset_download/dummy/download/production/upload/{hash[:2]}/{hash[2:]}" /tmp/

# 解码有序映射二进制
python3 -c "
import zlib, json
buf = open('/tmp/file', 'rb').read()
decompressed = zlib.decompress(buf[4:])  # 跳过头 4 字节
# 使用 wfax 或手动解析有序映射结构
"
```

**CDN 文件寻址公式**：`SHA1("master/.../table.orderedmap" + "K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy")`

**设备路径**：`production/upload/{hash前2位}/{hash剩余}`

### 2.4 数据分析工具

| 工具 | 用途 |
|------|------|
| `python3` + `json` | JSON 对比、结构分析、批量生成 |
| `sqlite3` | 查看 `wdfp_data.db` 验证服务端状态 |
| `grep` / `tail` | 日志分析 `[BATTLE]` `[QUEST]` 调试输出 |
| `console.log()` | 服务端关键路径埋点调试 |
| `msgpackr` | MsgPack 编码/解码 |

---

## 三、常见问题模式

### 3.1 客户端报错速查

| 错误码 | 含义 | 常见原因 | 排查入口 |
|--------|------|----------|---------|
| **C3212** | 找不到通关等级 | `clearRank` 为 NULL | `quest_progress` 表、`story_quest/finish` |
| **F1009** | 空指针 null pointer | `party_slot` 无效值 | `get_mainCharacters()` → home scene |
| **C8601** | CDN 键不存在 | `RareScoreRewardTable` 缺少稀有组 | CDN orderedmap 表 |
| **H404** | 端点不存在 | 未实现 API 路由 | `cn-server.ts` 注册 |
| **H400** | 请求错误 | 端点校验失败 | 日志 `[BATTLE] start failed` |

### 3.2 掉落相关排查链

```
现象：打完关卡无掉落
  ↓
1. 加日志确认掉落入口
   console.log(`[BATTLE] scoreReward groupId=${questData.scoreRewardGroupId} groupLen=...`)
   → groupId=undefined → 关卡 JSON 无 scoreRewardGroup
   → groupId=值, groupLen=null → score_reward.json 找不到该组

2. 确认 scoreRewardGroup 来源
   → 查转换脚本对应关卡的列索引（boss_battle=col[70], advent=col[76] 等）
   → 对照 CDN 原始数据验证

3. 确认稀有组存在性
   → 查 rare_score_reward.json 中是否有所引用的组
   → 查 ADB 客户端文件中是否有所引用的组（决定是否 C8601）

4. 确认 type 分类正确
   → type=0 (普通) → 客户端不查 RareScoreRewardTable → 无 C8601 风险
   → type=1 (稀有) → 客户端查 RareScoreRewardTable → 组必须存在
```

### 3.3 转换脚本 bug 模式

**Array wrapper bug**（最常见）：
```python
# CDN 数据格式（wfax 提取后）：
{"1": [["name", "0", "0", "10000076", "4", "320", "", ""]]}
#               ↑ 额外一层数组包裹！

# 转换脚本错误写法：
for _, reward in score_group.items():
    type = int(reward[1])  # reward = [["..."]], reward[1] → IndexError!

# 正确写法：
for _, reward_wrapper in score_group.items():
    reward = reward_wrapper[0]  # 解包
    type = int(reward[1])
```

**列索引错误**：
```python
# boss_battle 和 advent 事件的数据结构不同
"scoreRewardGroup": int(chapter[70])  # boss_battle 正确
"scoreRewardGroup": int(chapter[76])  # advent 正确（不是 70!）
```

---

## 四、调试工作流

### 4.1 通用流程

```
1. 日志定位
   grep "CRASH|ERR:|level\":50" /tmp/cn-server.log
   → 确定错误码和触发时机

2. 端点验证
   grep "POST.*url" /tmp/cn-server.log
   → 确认客户端调用了哪些 API，返回什么状态码

3. 数据对比
   diff <(python3 -c "json.dumps(server_data)") <(python3 -c "json.dumps(cdn_data)")
   → 找出服务端 JSON 与 CDN 原始数据的差异

4. 客户端提取（可选）
   adb pull → zlib 解压 → 有序映射解析
   → 确认客户端本地表的内容

5. 修复
   → 修改转换脚本（converter.py）
   → 重新生成 assets/ JSON
   → 或直接修改 JSON（如果是转换脚本之外的问题）
   → 构建重启
```

### 4.2 服务端快速加日志

```typescript
// singleBattleQuest.ts 掉落入口
console.log(`[BATTLE] scoreReward groupId=${questData.scoreRewardGroupId} groupLen=${questData.scoreRewardGroup?.length ?? 'null'} questId=${questId} category=${questCategory}`)

// quest.ts 稀有池处理
console.log(`[QUEST] givePlayerScoreRewards group=${groupId} items=${scoreRewards.length}`)
console.log(`[QUEST] RARE_POOL rareGroup=${rareGroupId} found=${group !== null} items=${group?.length ?? 0}`)
```

### 4.3 存档快速排查

```bash
# 查看最近完成的关卡
sqlite3 .database/wdfp_data.db "SELECT quest_id, clear_rank FROM players_quest_progress WHERE player_id=20 ORDER BY rowid DESC LIMIT 10"

# 查看编队状态
sqlite3 .database/wdfp_data.db "SELECT id, party_slot FROM players WHERE id=20"
```

---

## 五、关键数据文件映射

| CDN 源 (wf-assets-cn/orderedmap/) | 服务器 (starpoint-cn/assets/) | 重要列 |
|------|------|------|
| `reward/score_reward.json` | `assets/score_reward.json` | type, id, count, rarity |
| `reward/rare_score_reward.json` | `assets/rare_score_reward.json` | type, id, count, rarity |
| `quest/boss_battle_quest.json` | `assets/boss_battle_quest.json` | scoreRewardGroup (col[70]) |
| `quest/event/advent_event_quest.json` | `assets/advent_event_quest.json` | scoreRewardGroup (col[76]) |
| `shop/event_item_shop.json` | `assets/event_item_shop.json` | BOSS 币 ID → 商店商品 |
| `item/item.json` | — | 物品 ID → 中文名 |

---

## 六、经验总结

1. **CDN 原始数据是唯一标准答案**。不要自行构造合成数据——除非确认 CDN 中确实不存在。

2. **转换脚本是所有问题的根源**。Array wrapper、列索引、`||` vs `??` 等 JS/Python 差异，都是转换过程中的常见陷阱。

3. **type=0 vs type=1 是分水岭**。type=0 (普通) 走直接发放 → 客户端不查 RareScoreRewardTable → 不会 C8601。type=1 (稀有池) → 客户端查表 → 组必须存在。

4. **优先查 CDN**，再查客户端 ADB 提取，最后才考虑合成数据。

5. **DROP_MULTIPLIER** 在 `.env` 中配置，测试时设 10 便于快速积累，上线设 1。

6. **`wf-assets-cn` 的 `.pathlist`** 记录了所有 CDN 表的路径（976 条），是查找 CDN 数据的索引入口。

---

## 七、Gacha 动画种子生成（理论方案）

### 背景

C3032 错误：客户端收到 `seed` + `movie_id` 后，用 MersenneTwister(seed) 模拟弹珠物理，得出预期稀有度。若与角色实际稀有度不一致 → C3032。

### 种子需求

| movie_id | 动画配置 | 说明 |
|------|------|------|
| `normal` | `master/gacha/normal.orderedmap` | 常规卡池 |
| `fes` | `master/gacha/fes.orderedmap` | FES/流星祭 |
| `normal_guarantee` | `master/gacha/normal_guarantee.orderedmap` | 10 连保底 |
| `fes_guarantee` | `master/gacha/fes_guarantee.orderedmap` | FES 保底 |

每种配置需要按稀有度（★3/★4/★5）生成各自的种子池。

### 数据源

| 来源 | 路径 | 状态 |
|------|------|------|
| 动画配置文件 | `master/gacha/{movie_id}.orderedmap` | ⚠️ 本地 CDN ZIP 中未找到（可能仅 APK 内嵌） |
| 客户端弹珠物理源码 | `wf-2.1.125-cn-decompiled/scripts/scripts/pinball/gacha/ballMovie/fallingField/FallingField.as` | ✅ 可用 |
| 客户端种子校验 | `BallMovie.verifyResultBallRarity()` | ✅ 可参考 |

### 种子生成流程（计划）

```
1. 提取动画配置文件
   → SHA1("master/gacha/fes.orderedmap" + salt)
   → 从 CDN ZIP 或 APK 提取 orderedmap 二进制
   → zlib 解压 → JSON（ballStar4, amuletTwoUp, amulets[], playMovie 等阈值）

2. 在 Node.js 中实现 MersenneTwister(seed) 模拟
   → 参考 FallingField.as 的 initBallRarity() 和 precalculateFieldResult()
   → 输入：seed + movie 配置参数
   → 输出：ballRarityIndex (0=★3, 1=★4, 2=★5)

3. 暴力枚举
   for seed in range(10000000, 99999999):
       rarity = simulate(seed, movieConfig)
       if rarity matches target:
           seeds.push(seed)

4. 按 movie_type × rarity 分组输出
   → gacha_movie_seeds.json: {rarity: {movie_type: [seeds]}}
```

### 参考文件

- 客户端物理模拟：`wf-2.1.125-cn-decompiled/scripts/scripts/pinball/gacha/ballMovie/fallingField/FallingField.as`
- 种子校验逻辑：`BallMovie.verifyResultBallRarity()` 
- 动画资产加载：`BallMovieGachaSource.getGachaConfig()`
- 配置路径生成：`GachaMovieIdTools.getGachaConfigAssetPath()`

### 当前种子池

| 文件 | 常规 normal | 常规 guarantee | rate-up normal | rate-up guarantee |
|------|:---:|:---:|:---:|:---:|
| ★5 | 23 | 7 | 14 | **2** |
| ★4 | 124 | 44 | 56 | 24 |
| ★3 | 292 | — | 162 | — |

数据来源：历史抓包。`fes` 类型种子为空。
