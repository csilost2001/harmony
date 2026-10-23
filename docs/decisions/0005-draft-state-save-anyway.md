---
description: "設計は途中でも保存でき、スキーマ違反は保存を妨げず要確認として示す"
status: decided
period: "2026-04"
---

# 0005 途中でも保存できる (draft-state)

**状況**: 設計の途中は、スキーマに合わない状態が普通にある。保存を拒むと、作業が中断し、AI の出力も失われる。

**決めたこと**: 違反があっても保存は妨げない。違反は読み込み時に計算して「要確認」に出す (原本に警告を書き込まない)。

**理由**: 機械が出した警告で原本が汚れ、差分にも混じる。

**結果**: [draft-state-policy.md](../spec/draft-state-policy.md)。AI は保存のあと `designer__check_design` で 0 件にしてから報告する。保存前の確認には `designer__validate_design` がある。
