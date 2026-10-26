# LUMINA — 크리스탈 샌드박스

브라우저에서 바로 플레이하는 무한 3D 블록 샌드박스. 외부 라이브러리 없이 순수 WebGL + HTML/CSS/JavaScript.

## GitHub Pages 배포
1. 새 저장소를 만들고 이 폴더의 **모든 파일**(`index.html`, `css/`, `js/`, `.nojekyll`)을 저장소 루트에 업로드
2. Settings → Pages → Branch: `main` / `(root)` → Save
3. 잠시 후 `https://<아이디>.github.io/<저장소>/` 에서 플레이

로컬 테스트: `index.html`을 더블클릭하거나 `python3 -m http.server` 실행.

## 조작
| | 컴퓨터 | 모바일 |
|---|---|---|
| 이동 | WASD | 왼쪽 드래그(조이스틱) |
| 시점 | 마우스 | 오른쪽 드래그 |
| 점프 / **활공** | Space (공중에서 한 번 더 눌러 유지) | 점프 버튼 (공중에서 다시 눌러 유지) |
| 부수기 / 놓기 | 좌클릭 / 우클릭 | 버튼 |
| 시점 전환 | V | 👤 버튼 |
| 블록 선택 | 1–9, 휠, E | 핫바 탭, ▦ 버튼 |
| 설정 | Esc | ⚙ 버튼 |

## 구조
- `js/gfx.js` WebGL 렌더러 · `js/world.js` 무한 청크/지형/메싱 · `js/blocks.js` 절차적 블록 텍스처
- `js/player.js` 물리·체력·낙사·글라이드 · `js/character.js` 캐릭터 · `js/controls.js` PC/모바일 입력
- `js/ui.js` HUD·설정창·캐릭터 편집 · `js/main.js` 게임 루프

## 독창 요소
공중섬 + 빛나는 루미나 크리스탈/발광초(밤에 주변을 물들임) + 윙 글라이드(활공 중 낙하 피해 없음, 에너지 소모)
