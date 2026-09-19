data/gemma-tokenizer.model — Gemma 4 토크나이저 (SentencePiece BPE)
출처: https://huggingface.co/omote-ai/gemma-4-e2b-tokenizer
라이선스: Apache 2.0 (Gemma 4, https://ai.google.dev/gemma/apache_2)

구글 공식 google/gemma-4-31B-it 에는 tokenizer.json(32MB) 뿐이고 .model 이 없다.
이 파일은 합성본이라 공식 어휘와 대조해 두었다 — 262,144개가 id 차례까지 전부 같았다.
다시 확인하려면 notes/experiments/b60-gemma-tokenizer.js 를 돌린다.

data/ai-models.json — 모델 프로필
출처: https://github.com/PocketRisu/pocketrisu-model-registry (CC0-1.0)
갱신: node scripts/refresh-ai-models.js
