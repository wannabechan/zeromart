# bzcat 코드를 복사해 별도 프로젝트 만드는 방법

원본 bzcat에 영향을 주지 않고, 코드를 복사해 새 프로젝트로 개발을 이어가는 단계별 가이드입니다.

---

## 1단계: 새 프로젝트 폴더 만들기

**bzcat2 폴더 밖**에 새 디렉터리를 만듭니다. 같은 상위 폴더에 두는 것을 권장합니다.

```bash
# 예: vibecoding 폴더 안에 새 프로젝트 생성
cd /Users/wannabechan/vibecoding
mkdir 새프로젝트이름
cd 새프로젝트이름
```

예: `bzcat-fork`, `bzcat-v2`, `my-catering` 등 원하는 이름 사용.

---

## 2단계: bzcat 코드 복사 (git 이력 없이)

원본 **bzcat의 git 이력은 가져오지 않고**, 현재 파일만 복사합니다.

```bash
# bzcat2가 있는 폴더로 이동한 뒤
cd /Users/wannabechan/vibecoding

# .git을 제외하고 bzcat2 전체 복사
rsync -av --exclude='.git' --exclude='node_modules' bzcat2/ 새프로젝트이름/
```

- `--exclude='.git'` → 원본과 같은 저장소가 되지 않도록
- `--exclude='node_modules'` → 나중에 새 프로젝트에서 `npm install` 하기 위해

**rsync가 없다면** (macOS에는 보통 있음):

```bash
cp -R /Users/wannabechan/vibecoding/bzcat2/* 새프로젝트이름/
cp /Users/wannabechan/vibecoding/bzcat2/.gitignore 새프로젝트이름/ 2>/dev/null || true
# 새 폴더에서 .git 폴더가 복사됐다면 삭제
rm -rf 새프로젝트이름/.git
```

---

## 3단계: 새 프로젝트를 독립된 Git 저장소로 초기화

복사한 폴더를 **새 Git 저장소**로 만듭니다. bzcat과 완전히 별개입니다.

```bash
cd /Users/wannabechan/vibecoding/새프로젝트이름

git init
git add .
git commit -m "Initial commit: fork from bzcat"
```

원격 저장소를 쓰려면:

```bash
# GitHub/GitLab 등에서 새 빈 저장소 생성 후
git remote add origin https://github.com/사용자명/새저장소이름.git
git branch -M main
git push -u origin main
```

---

## 4단계: 프로젝트 식별 정보 변경

새 프로젝트임을 구분하기 위해 다음을 수정합니다.

| 파일 | 수정할 내용 |
|------|-------------|
| `package.json` | `name`, `description` 등 프로젝트 이름/설명 변경 |
| `README.md` | 새 프로젝트 이름·설명으로 수정 |
| `vercel.json` (있다면) | 프로젝트/도메인 관련 설정이 있다면 새 프로젝트에 맞게 수정 |

예시 (`package.json`):

```json
{
  "name": "새프로젝트이름",
  "version": "1.0.0",
  "description": "새 프로젝트 한 줄 설명",
  ...
}
```

---

## 5단계: 환경 변수·비밀값 분리

원본 bzcat과 **같은 키/비밀을 공유하지 않도록** 새 프로젝트 전용 환경을 씁니다.

- `.env`, `.env.local` 등은 **복사하지 않았을 수 있음** (.gitignore 대상).  
  새 프로젝트용으로 **새로 작성**합니다.
- Vercel/Upstash/Resend 등 서비스는 **새 프로젝트용 프로젝트/키**를 만들고, 그 키만 새 프로젝트의 환경 변수에 등록합니다.
- `key/` 폴더에 있는 키 파일은 원본 것을 쓰지 말고, 새 프로젝트용 키를 생성해 사용합니다.

이렇게 하면 bzcat과 새 프로젝트가 DB·메일·결제 등이 완전히 분리됩니다.

---

## 6단계: 의존성 설치 및 로컬 실행

복사 시 `node_modules`를 제외했으므로, 새 프로젝트에서 한 번 설치합니다.

```bash
cd /Users/wannabechan/vibecoding/새프로젝트이름
npm install
npm run local
```

이후부터는 이 새 폴더에서만 작업하면 됩니다.

---

## 7단계: (선택) 원격 배포

- **Vercel**: Vercel 대시보드에서 **새 프로젝트**를 만들고, 방금 만든 **새 Git 저장소**를 연결합니다.  
  bzcat 프로젝트가 아닌, 새 저장소를 선택해야 원본에 영향 없음.
- 환경 변수는 5단계에서 정리한 **새 프로젝트 전용 값**만 넣습니다.

---

## 요약 체크리스트

- [ ] bzcat2 **밖**에 새 폴더 생성
- [ ] `.git`, `node_modules` 제외하고 bzcat2 내용 복사
- [ ] 새 폴더에서 `git init` 후 첫 커밋 (원격은 선택)
- [ ] `package.json` / README 등 프로젝트 이름·설명 변경
- [ ] 환경 변수·API 키는 새 프로젝트 전용으로 새로 설정
- [ ] `npm install` 후 `npm run local`로 동작 확인
- [ ] 배포 시 새 Vercel(또는 다른) 프로젝트에 새 저장소 연결

이 순서대로 하면 **bzcat 원본은 그대로 두고**, 복사본만 별도 프로젝트로 개발할 수 있습니다.
