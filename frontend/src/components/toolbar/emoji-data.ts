/** 내장 이모지 1,849개. 시스템 이모지·내장 국기 글꼴로 표시하며 네트워크를 사용하지 않는다.
 * Unicode emoji-test 15.1 중 Emoji 14.0 이하 기본형 + CLDR 44 한국어 이름·검색어.
 * 피부색 조합은 제외. 국가/지역 국기는 별도 분류. 기존 이름·코드·분류는 유지한다.
 * https://unicode.org/Public/emoji/15.1/emoji-test.txt
 * https://github.com/unicode-org/cldr/tree/release-44/common/annotations
 * 라이선스: frontend/public/licenses/UNICODE-LICENSE.txt
 * 형식: 글자|한국어 이름|짧은 코드|검색어
 */
export interface Emoji {
  char: string;
  name: string;
  code: string;
  keywords: string;
}
export interface EmojiCategory {
  id: string;
  label: string;
  icon: string;
  items: Emoji[];
}

const parse = (rows: string) =>
  rows
    .trim()
    .split("\n")
    .map((row) => {
      const [char, name, code, keywords = ""] = row.trim().split("|");
      return { char, name, code, keywords };
    });

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "face",
    label: "표정",
    icon: "😀",
    items: parse(`
😀|웃는 얼굴|grinning|웃음 미소 기쁨 smile 활짝 웃는 얼굴 스마일 grinning face
😃|크게 웃는 얼굴|smiley|웃음 기쁨 smile 눈을 크게 뜨고 웃는 얼굴 미소 스마일 입 벌리고 grinning face with big eyes
😄|눈웃음|smile|웃음 행복 미소 짓는 눈으로 활짝 웃는 얼굴 스마일 입 벌리고 눈웃음 grinning face with smiling eyes
😁|활짝 웃는 얼굴|grin|웃음 이빨 기쁨 미소 짓는 눈으로 웃는 얼굴 눈웃음 스마일 beaming face with smiling eyes
😆|깔깔 웃는 얼굴|laughing|웃음 폭소 눈웃음짓는 얼굴 눈 감고 미소 웃는 입 벌리고 grinning squinting face
😅|식은땀 웃음|sweat_smile|웃음 민망 땀 흘리며 웃는 얼굴 미소 스마일 식은땀 웃고 있지만 당황한 grinning face with sweat
😂|기쁨의 눈물|joy|웃음 눈물 폭소 ㅋㅋ 기쁨의 눈물을 흘리는 얼굴 기쁨 스마일 face with tears of joy
🤣|데굴데굴 웃음|rofl|웃음 폭소 ㅋㅋ 바닥을 구르며 웃는 얼굴 구르기 데굴데굴 바닥 rolling on the floor laughing
😊|수줍은 미소|blush|미소 행복 수줍음 짓는 눈으로 살짝 웃는 얼굴 눈웃음 스마일 smiling face with eyes
😇|천사 얼굴|innocent|천사 착함 후광이 비치는 웃는 얼굴 미소 스마일 smiling face with halo
🙂|살짝 미소|slightly_smiling_face|미소 살짝 짓는 얼굴 slightly smiling face
🙃|거꾸로 얼굴|upside_down_face|장난 거꾸로 된 얼굴 뒤집힘 위아래 upside-down face
😉|윙크|wink|윙크 장난 윙크하는 얼굴 winking face
😍|하트 눈|heart_eyes|사랑 하트 좋아 눈 얼굴 뿅뿅 smiling face with heart-eyes
🤔|생각하는 얼굴|thinking|생각 고민 음 생각하는 얼굴 중 생각에 잠긴 thinking face
😎|선글라스|sunglasses|멋짐 쿨 선글라스 낀 얼굴 smiling face with sunglasses
🥰|하트 미소|smiling_face_with_hearts|사랑 하트 행복 하트와 함께 웃는 얼굴 반한 사랑에 빠진 사랑하는 smiling face with hearts
😘|키스|kissing_heart|키스 뽀뽀 사랑 키스를 보내는 얼굴 날리는 face blowing a kiss
😋|맛있는 얼굴|yum|맛있다 음식 맛있는 음식을 음미하는 얼굴 맛있어 맛있어하는 face savoring food
😜|메롱|stuck_out_tongue_winking_eye|장난 메롱 윙크하면서 혀를 내민 얼굴 메롱하는 winking face with tongue
🤗|포옹|hugs|안아 포옹 고마움 포옹하고 있는 얼굴 반가워하는 환영 smiling face with open hands
🤩|반한 얼굴|star_struck|별 감탄 최고 반한 얼굴 눈 모양의 star-struck
😐|무표정|neutral_face|무표정 멍 덤덤한 얼굴 neutral face
😴|자는 얼굴|sleeping|잠 졸림 피곤 졸고 있는 얼굴 자고 sleeping face
😢|우는 얼굴|cry|슬픔 눈물 울음 우는 얼굴 crying face
😭|엉엉 우는 얼굴|sob|슬픔 눈물 울음 ㅠㅠ 엉엉 우는 얼굴 대성통곡 loudly crying face
😡|화난 얼굴|rage|화남 분노 뾰로통한 얼굴 뾰로통함 enraged face
😱|놀라 비명|scream|놀람 공포 충격 공포에 절규하는 얼굴 비명 소리 지르는 face screaming in fear
😮|놀란 얼굴|open_mouth|놀람 헉 입벌린 얼굴 입벌림 face with open mouth
🥲|웃픈 얼굴|smiling_face_with_tear|웃음 눈물 슬픔 흘리며 웃는 얼굴 감사 긍지 미소 안도 smiling face with tear
🙄|눈 굴리기|roll_eyes|짜증 한심 눈을 굴리고 있는 얼굴 눈 굴리기 face with rolling eyes
😬|이 악물기|grimacing|민망 어색 찌푸린 얼굴 찡그림 grimacing face
🤯|머리 폭발|exploding_head|충격 대박 폭발하는 얼굴 뚜껑 열린 머리 폭발 exploding head
🥳|파티 얼굴|partying_face|축하 파티 생일 파티하는 얼굴 고깔모자 나팔 partying face
😷|마스크|mask|아픔 감기 병 마스크 낀 얼굴 황사 face with medical mask
🤒|열나는 얼굴|face_with_thermometer|아픔 열 감기 체온계를 물고 있는 얼굴 병 체온계 face with thermometer
🫠|녹아 내리는 얼굴|melting_face|녹아 내리는 얼굴 melting face
😗|키스하는 얼굴|kissing_face|뽀뽀 얼굴 입술을 내민 키스 키스하는 kissing face
☺️|웃는 얼굴|smiling_face|미소 스마일 웃는 얼굴 웃음 짓는 smiling face
😚|눈을 감은 채로 키스하는 얼굴|kissing_face_with_closed_eyes|눈을 감은 채로 키스하는 얼굴 뽀뽀 키스 kissing face with closed eyes
😙|미소 짓는 눈으로 키스하는 얼굴|kissing_face_with_smiling_eyes|미소 짓는 눈으로 키스하는 얼굴 뽀뽀 웃으면서 뽀뽀하는 입술을 내민 키스 kissing face with smiling eyes
😛|혀를 내민 얼굴|face_with_tongue|메롱하는 얼굴 혀를 내민 face with tongue
🤪|괴짜 얼굴|zany_face|괴짜 얼굴 엉뚱한 익살스러운 zany face
😝|눈을 감고 메롱하는 얼굴|squinting_face_with_tongue|눈을 감고 메롱하는 얼굴 혀를 내민 squinting face with tongue
🤑|돈 모양의 입이 있는 얼굴|money_mouth_face|돈 모양의 입이 있는 얼굴 욕심 입 탐욕 money-mouth face
🤭|손으로 입을 가린 얼굴|face_with_hand_over_mouth|손으로 입을 가린 얼굴 앗 face with hand over mouth
🫢|눈을 뜨고 손으로 입을 가린 얼굴|face_with_open_eyes_and_hand_over_mouth|감탄 깜짝 놀란 열굴 놀라움 눈을 뜨고 손으로 입을 가린 얼굴 당황 믿기지 않음 서프라이즈 face with open eyes and hand over mouth
🫣|한쪽 눈을 가리고 훔쳐보는 얼굴|face_with_peeking_eye|매료됨 빤히 쳐다보기 한쪽 눈을 가리고 훔쳐보는 얼굴 훔쳐보기 face with peeking eye
🤫|쉿 하는 얼굴|shushing_face|쉿 하는 얼굴 조용 shushing face
🫡|경례하는 얼굴|saluting_face|경례 경례하는 얼굴 군대 네 알았어 응 화창 saluting face
🤐|지퍼로 입을 잠근 얼굴|zipper_mouth_face|비밀 얼굴 입 지퍼 지퍼로 입을 잠근 zipper-mouth face
🤨|눈썹을 치켜올린 얼굴|face_with_raised_eyebrow|눈썹을 치켜올린 얼굴 불신 의심 face with raised eyebrow
😑|무표정한 얼굴|expressionless_face|무표정한 얼굴 포커페이스 표정 없는 expressionless face
😶|입이 없는 얼굴|face_without_mouth|얼굴 입 없음 입이 없는 face without mouth
🫥|테두리가 점선으로 된 얼굴|dotted_line_face|내성적 보이지 않음 사라짐 숨기 우울 좌절 테두리가 점선으로 된 얼굴 dotted line face
😶‍🌫️|공상에 잠긴 얼굴|face_in_clouds|공상에 잠긴 얼굴 멍 멍청한 멍함 안개 속 엉뚱한 생각에 face in clouds
😏|히죽거리는 얼굴|smirking_face|웃는 얼굴 히죽거리는 히죽히죽 smirking face
😒|지루해하는 얼굴|unamused_face|얼굴 재미 없어 하는 지루함 지루해하는 unamused face
😮‍💨|날숨 쉬는 얼굴|face_exhaling|날숨 쉬는 얼굴 속삭임 안도 한숨 휘파람 face exhaling
🤥|거짓말하는 얼굴|lying_face|거짓말 거짓말쟁이 거짓말하는 얼굴 피노키오 lying face
😌|안심한 얼굴|relieved_face|안도 안심한 얼굴 표정 relieved face
😔|수심 어린 얼굴|pensive_face|낙담 낙담한 얼굴 수심 어린 수심에 찬 pensive face
😪|졸린 얼굴|sleepy_face|얼굴 졸린 졸림 sleepy face
🤤|침 흘리는 얼굴|drooling_face|얼굴 주르륵 침 흘리는 침흘리기 drooling face
🤕|머리에 붕대를 감은 얼굴|face_with_head_bandage|머리에 붕대를 감은 얼굴 부상 붕대 상처 face with head-bandage
🤢|구역질을 하는 얼굴|nauseated_face|구역질을 하는 얼굴 구토 속 울렁거림 토하기 nauseated face
🤮|토하는 얼굴|face_vomiting|토 토하는 얼굴 face vomiting
🤧|재채기하는 얼굴|sneezing_face|얼굴 에취 재채기 재채기하는 휴지 sneezing face
🥵|더운 얼굴|hot_face|더운 얼굴 더위 먹은 땀 흘리는 빨개진 열나는 hot face
🥶|추워하는 얼굴|cold_face|고드름 동상 새파랗게 질린 얼어붙은 추운 추워하는 얼굴 cold face
🥴|헤롱헤롱 얼굴|woozy_face|맛이 간 비뚤거리는 입 어지러운 취한 헤롱거리는 헤롱헤롱 얼굴 woozy face
😵|어지러운 얼굴|face_with_crossed_out_eyes|어지러운 얼굴 어지러움 face with crossed-out eyes
😵‍💫|현기증 난 얼굴|face_with_spiral_eyes|나선형 눈 어지럼증 현기증 난 얼굴 face with spiral eyes
🤠|카우보이 모자 쓴 얼굴|cowboy_hat_face|모자 얼굴 카우보이 쓴 cowboy hat face
🥸|변장한 얼굴|disguised_face|가면 변장 변장한 얼굴 안경 코 disguised face
🤓|모범생 얼굴|nerd_face|공부벌레 괴짜 모범생 범생이 얼굴 nerd face
🧐|단안경을 쓴 얼굴|face_with_monocle|단안경을 쓴 얼굴 face with monocle
😕|혼란스러워하는 얼굴|confused_face|얼굴 헷갈림 혼란스러워하는 confused face
🫤|입이 한쪽으로 올라간 얼굴|face_with_diagonal_mouth|별로 실망 의심 입이 한쪽으로 올라간 얼굴 확신이 없음 face with diagonal mouth
😟|걱정스러운 얼굴|worried_face|걱정 걱정스러운 얼굴 worried face
🙁|살짝 찡그린 얼굴|slightly_frowning_face|살짝 찡그린 얼굴 찡그림 slightly frowning face
☹️|찡그린 얼굴|frowning_face|얼굴 찡그린 찡그림 frowning face
😯|숨죽인 얼굴|hushed_face|숨죽인 얼굴 숨죽임 hushed face
😲|깜짝 놀란 얼굴|astonished_face|깜짝 놀란 얼굴 놀라움 충격 astonished face
😳|상기된 얼굴|flushed_face|달아오른 얼굴 붉힌 상기된 붉힘 flushed face
🥺|애원하는 얼굴|pleading_face|글썽이는 눈 애원하는 얼굴 자비를 구하는 pleading face
🥹|눈물을 참는 얼굴|face_holding_back_tears|눈물을 참는 얼굴 슬픔 울음 자랑스러움 참음 화난 face holding back tears
😦|입 벌리고 찌푸린 얼굴|frowning_face_with_open_mouth|얼굴 입 벌리고 찌푸린 frowning face with open mouth
😧|괴로워하는 얼굴|anguished_face|괴로움 괴로워하는 얼굴 anguished face
😨|두려워하는 얼굴|fearful_face|공포 공포에 가득찬 얼굴 두려움 두려워하는 fearful face
😰|땀 흘리며 불안해하는 얼굴|anxious_face_with_sweat|땀 흘리며 불안해하는 얼굴 식은땀 anxious face with sweat
😥|실망했지만 안도하는 얼굴|sad_but_relieved_face|실망감 실망하는 얼굴 실망했지만 안도하는 안도감 휴 sad but relieved face
😖|당혹한 얼굴|confounded_face|당혹한 얼굴 당혹함 confounded face
😣|참아내는 얼굴|persevering_face|실수한 후 얼굴 얼빠짐 참아내는 persevering face
😞|실망한 얼굴|disappointed_face|실망 실망한 얼굴 disappointed face
😓|식은땀 흘리는 얼굴|downcast_face_with_sweat|식은땀 흘리는 얼굴 downcast face with sweat
😩|지친 얼굴|weary_face|얼굴 지친 지침 weary face
😫|피곤한 얼굴|tired_face|얼굴 피곤한 피곤함 tired face
🥱|하품하는 얼굴|yawning_face|지루함 피곤함 하품 하품하는 얼굴 yawning face
😤|화내며 씩씩거리는 얼굴|face_with_steam_from_nose|승리감 얼굴 이겼다 화내며 씩씩거리는 face with steam from nose
😠|화난 얼굴|angry_face|분노 얼굴 화 화난 angry face
🤬|욕하는 얼굴|face_with_symbols_on_mouth|욕 욕하는 얼굴 face with symbols on mouth
😈|머리에 뿔이 달린 웃는 얼굴|smiling_face_with_horns|머리에 뿔이 달린 웃는 얼굴 미소 스마일 smiling face with horns
👿|머리에 뿔이 달린 화난 얼굴|angry_face_with_horns|꼬마 악마 머리에 뿔이 달린 화난 얼굴 angry face with horns
💀|해골|skull|해골 바가지 skull
☠️|해골과 뼈다귀|skull_and_crossbones|뼈다귀 해골 해골과 skull and crossbones
💩|똥|pile_of_poo|똥 똥무더기 pile of poo
🤡|어릿광대 얼굴|clown_face|광대 어릿광대 얼굴 clown face
👹|도깨비 가면|ogre|가면 도깨비 ogre
👺|코주부 도깨비 가면|goblin|가면 코주부 도깨비 goblin
👻|유령|ghost|고스트 귀신 유령 ghost
👽|외계인|alien|UFO 에일리언 왕눈이 외계인 alien
👾|에일리언|alien_monster|UFO 몬스터 에일리언 외계 괴물 외계인 우주생명체 alien monster
🤖|로봇 얼굴|robot|로봇 얼굴 robot
😺|활짝 웃는 고양이 얼굴|grinning_cat|고양이 입벌리고 활짝 웃는 얼굴 grinning cat
😸|미소 짓는 눈으로 활짝 웃는 고양이 얼굴|grinning_cat_with_smiling_eyes|고양이 미소 짓는 눈으로 활짝 웃는 얼굴 grinning cat with smiling eyes
😹|기쁨의 눈물을 흘리는 고양이 얼굴|cat_with_tears_of_joy|고양이 기뻐하면서 우는 기쁨의 눈물 눈물을 흘리는 얼굴 cat with tears of joy
😻|하트 눈 고양이 얼굴|smiling_cat_with_heart_eyes|고양이 사랑에 빠진 하트 눈 얼굴 smiling cat with heart-eyes
😼|썩소 짓는 고양이|cat_with_wry_smile|고소하다는 웃음 짓는 고양이 쌤통 썩소 cat with wry smile
😽|키스하는 고양이 얼굴|kissing_cat|고양이 눈 감고 뽀뽀하는 뽀뽀 키스 키스하는 얼굴 kissing cat
🙀|절규하는 고양이 얼굴|weary_cat|고양이 맙소사 절규하는 얼굴 weary cat
😿|울고 있는 고양이 얼굴|crying_cat|고양이 눈물 흘리는 울고 있는 얼굴 훌쩍 crying cat
😾|뾰로통한 고양이 얼굴|pouting_cat|고양이 뾰로통한 얼굴 토라짐 pouting cat
🙈|눈을 가리고 있는 원숭이|see_no_evil_monkey|눈을 가리고 있는 원숭이 손으로 가린 아무것도 안 보려는 see-no-evil monkey
🙉|귀를 막고 있는 원숭이|hear_no_evil_monkey|귀를 막고 있는 원숭이 손으로 가린 아무것도 안 들리는 hear-no-evil monkey
🙊|입을 막고 있는 원숭이|speak_no_evil_monkey|손으로 입을 가린 원숭이 아무것도 말할 수 없는 막고 있는 speak-no-evil monkey`),
  },
  {
    id: "people",
    label: "사람",
    icon: "👋",
    items: parse(`
👋|손 흔들기|wave|안녕 인사 손 흔드는 펼친 waving hand
👍|좋아요|thumbsup|좋아 최고 엄지 확인 올린 따봉 좋아요 thumbs up
👎|싫어요|thumbsdown|싫어 별로 엄지 내린 싫어요 야유 최악 thumbs down
👏|박수|clap|박수 축하 칭찬 손뼉 치기 clapping hands
🙌|만세|raised_hands|만세 축하 두 손을 든 사람 하고 있는 제스처 하이파이브 raising hands
🙏|두 손 모음|pray|부탁 감사 기도 기도하는 사람 두 손 모아 합장 folded hands
🤝|악수|handshake|악수 협력 약속 미팅 손 합의 회의 handshake
✌️|브이|v|브이 승리 평화 표시 가위 찌 victory hand
👌|오케이|ok_hand|좋아 괜찮아 오케이 오케이를 표시한 손 돈 신호 OK hand
✋|손바닥|raised_hand|손 멈춤 하이파이브 손바닥 보 보자기 raised hand
🤞|행운 빌기|crossed_fingers|행운 바람 검지와 중지 크로스 검지 교차 손가락 crossed fingers
💪|힘|muscle|힘 근육 화이팅 알통 강함 이두박근 flexed biceps
👉|오른쪽 가리키기|point_right|가리킴 손가락 오른쪽을 가리키는 손등 검지손가락 오른쪽으로 손가락으로 오른쪽 가리키기 backhand index pointing right
👈|왼쪽 가리키기|point_left|가리킴 손가락 왼쪽을 가리키는 손등 검지손가락 왼쪽으로 손가락으로 왼쪽 가리키기 backhand index pointing left
👆|위 가리키기|point_up_2|가리킴 위 위쪽을 가리키는 손등 검지손가락 손가락 위로 손가락으로 위를 가리키기 위쪽 backhand index pointing up
👇|아래 가리키기|point_down|가리킴 아래 아래쪽을 가리키는 손등 검지손가락 손가락 아래로 손가락으로 아래를 가리키기 아래쪽 backhand index pointing down
✍️|글 쓰는 손|writing_hand|글쓰기 메모 기록 글을 쓰고 있는 손 연필 쥔 writing hand
👀|눈|eyes|보기 확인 관심 왕눈이 눈알 신체 얼굴 eyes
🧠|뇌|brain|생각 아이디어 공부 뇌 brain
🙋|손 든 사람|raising_hand|질문 손들기 한 손 든 사람 즐거워하는 손을 들고 person raising hand
🤷|모르겠음|shrug|몰라 글쎄 어깨를 으쓱하는 사람 상관없어 어깨 으쓱 잘 모르겠음 person shrugging
🙆|오케이 사람|ok_woman|좋아 동그라미 오케이라는 제스처를 하는 사람 OK 오케이 제스처 person gesturing
🙅|안 돼 사람|no_good|안돼 금지 엑스 안 된다는 제스처를 하는 사람 손 제스처 person gesturing NO
🧑‍💻|개발자|technologist|개발 코딩 컴퓨터 기술 전문가 개발자 발명가 소프트웨어 technologist
👨‍👩‍👧|가족|family|가족 부모 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, woman, girl
🏃|달리는 사람|runner|달리기 운동 급함 뛰는 사람 뛰기 런닝 마라톤 person running
🤚|손등|raised_back_of_hand|들어보이기 손등 손바닥 raised back of hand
🖐️|쫙 편 손바닥|hand_with_fingers_splayed|손바닥 안녕 인사 쫙 편 hand with fingers splayed
🖖|벌칸식 인사|vulcan_salute|경례 벌칸식 인사 손 모양 vulcan salute
🫱|오른쪽으로 향하는 손등|rightwards_hand|손 오른쪽 방향 오른쪽으로 향하는 손등 우측 rightwards hand
🫲|왼쪽으로 향하는 손바닥|leftwards_hand|손 왼쪽 방향 왼쪽으로 향하는 손바닥 좌측 leftwards hand
🫳|손바닥을 아래로 향한 손|palm_down_hand|그만두라는 손 물러나 손바닥을 아래로 향한 저리 가 palm down hand
🫴|손바닥을 위로 향한 손|palm_up_hand|부르는 손 손바닥을 위로 향한 이리 와 잡기 제안 palm up hand
🤌|꼬집는 손가락|pinched_fingers|꼬집는 빈정대는 손가락 손동작 질문 pinched fingers
🤏|꼬집는 손|pinching_hand|꼬집는 손 적은 양을 나타내는 pinching hand
🫰|엄지와 중지를 교차한 손|hand_with_index_finger_and_thumb_crossed|너무 비싼 돈 딱딱 사랑 엄지와 중지를 교차한 손 하트 hand with index finger and thumb crossed
🤟|사랑을 표시하는 손|love_you_gesture|사랑 제스처 사랑을 표시하는 손 사랑해 love-you gesture
🤘|뿔 모양 손짓|sign_of_the_horns|락 음악 뿔 모양 손짓 손 힙합 sign of the horns
🤙|전화를 걸라는 손 모양|call_me_hand|손가락 손모양 전화 전화를 걸라는 손 모양 call me hand
🖕|중지|middle_finger|가운데 손가락 욕설 중지 middle finger
☝️|위쪽을 가리키는 손|index_pointing_up|가리키기 검지 위쪽을 가리키는 손 index pointing up
🫵|보는 사람을 가리키는 검지|index_pointing_at_the_viewer|가리키기 보는 사람을 가리키는 검지 상대방 index pointing at the viewer
✊|주먹|raised_fist|묵 바위 주먹 raised fist
👊|주먹 전면|oncoming_fist|주먹 전면 펀치 oncoming fist
🤛|왼쪽을 향하는 주먹|left_facing_fist|왼쪽 왼쪽을 향하는 주먹 왼편 left-facing fist
🤜|오른쪽을 향하는 주먹|right_facing_fist|오른쪽 오른쪽을 향하는 주먹 오른편 right-facing fist
🫶|손 하트|heart_hands|사랑 손 하트 heart hands
👐|양손을 모아서 벌린 모양|open_hands|두 손 펼치기 양손을 모아서 벌린 모양 펼친 open hands
🤲|내민 두 손|palms_up_together|기도 내민 두 손 palms up together
💅|매니큐어|nail_polish|네일 아트 케어 매니큐어 nail polish
🤳|셀카|selfie|사진 셀카 셀피 카메라 selfie
🦾|기계 팔|mechanical_arm|기계 팔 인공 mechanical arm
🦿|인공 다리|mechanical_leg|인공 기관 다리 접근성 mechanical leg
🦵|한쪽 다리|leg|다리 한쪽 킥 leg
🦶|한쪽 발|foot|발 한쪽 발구르기 킥 foot
👂|귀|ear|귀 몸 ear
🦻|보청기를 낀 귀|ear_with_hearing_aid|보청기를 낀 귀 접근성 청각장애 ear with hearing aid
👃|코|nose|몸 코 nose
🫀|심장|anatomical_heart|맥박 심장 심장학 장기 해부학 anatomical heart
🫁|폐|lungs|내쉬기 들이마시기 숨 장기 폐 호흡 lungs
🦷|이빨|tooth|이빨 치과 tooth
🦴|뼈다귀|bone|뼈 뼈다귀 bone
👁️|눈|eye|눈 시력 신체 얼굴 eye
👅|혀|tongue|메롱 몸 혀 tongue
👄|입|mouth|몸 입 mouth
🫦|입술을 깨물고 있는 입|biting_lip|걱정 겁 불안 예민함 입술을 깨물고 있는 입 초조함 플러팅 biting lip
👶|아기|baby|아기 유아 baby
🧒|어린이|child|어린이 child
👦|남자 아이|boy|남자 아이 소년 boy
👧|여자 아이|girl|소녀 여자 아이 girl
🧑|사람|person|사람 성별 없음 성인 person
👱|금발인 사람|person_blond_hair|금발 금발인 사람 person: blond hair
👨|남자|man|남성 남자 성인 man
🧔|수염 난 사람|person_beard|사람 수염 난 person: beard
🧔‍♂️|수염 난 남자|man_beard|남자 수염 난 man: beard
🧔‍♀️|수염 난 여자|woman_beard|수염 난 여자 woman: beard
👨‍🦰|남자: 빨간 머리|man_red_hair|남성 남자 남자: 빨간 머리 성인 man: red hair
👨‍🦱|남자: 곱슬머리|man_curly_hair|곱슬머리 남성 남자 남자: 성인 man: curly hair
👨‍🦳|남자: 백발|man_white_hair|남성 남자 남자: 백발 성인 man: white hair
👨‍🦲|남자: 대머리|man_bald|남성 남자 남자: 대머리 성인 man: bald
👩|여자|woman|성인 여성 여자 woman
👩‍🦰|여자: 빨간 머리|woman_red_hair|빨간 머리 성인 여성 여자 여자: woman: red hair
🧑‍🦰|사람: 빨간 머리|person_red_hair|빨간 머리 사람 사람: 성별 없음 성인 person: red hair
👩‍🦱|여자: 곱슬머리|woman_curly_hair|곱슬머리 성인 여성 여자 여자: woman: curly hair
🧑‍🦱|사람: 곱슬머리|person_curly_hair|곱슬머리 사람 사람: 성별 없음 성인 person: curly hair
👩‍🦳|여자: 백발|woman_white_hair|백발 성인 여성 여자 여자: woman: white hair
🧑‍🦳|사람: 백발|person_white_hair|백발 사람 사람: 성별 없음 성인 person: white hair
👩‍🦲|여자: 대머리|woman_bald|대머리 성인 여성 여자 여자: woman: bald
🧑‍🦲|사람: 대머리|person_bald|대머리 사람 사람: 성별 없음 성인 person: bald
👱‍♀️|금발 여자|woman_blond_hair|금발 여성 여자 woman: blond hair
👱‍♂️|금발 남자|man_blond_hair|금발 남성 남자 man: blond hair
🧓|노인|older_person|노인 성별 없음 성인 older person
👴|할아버지|old_man|남성 남자 노인 성인 할아버지 old man
👵|할머니|old_woman|노인 성인 여성 여자 할머니 old woman
🙍|찌푸린 사람|person_frowning|짜증 찌푸린 사람 person frowning
🙍‍♂️|찌푸린 남자|man_frowning|얼굴 찌푸린 남자 찌푸림 찡그림 man frowning
🙍‍♀️|찌푸린 여자|woman_frowning|얼굴 찌푸린 여자 찌푸림 찡그림 woman frowning
🙎|뾰로통한 사람|person_pouting|뾰로통한 사람 뿌루퉁한 person pouting
🙎‍♂️|뾰로통한 남자|man_pouting|불만 뾰로통 뾰로통한 남자 여자 뿌루퉁 심통 man pouting
🙎‍♀️|뾰로통한 여자|woman_pouting|불만 뾰로통 뾰로통한 여자 뿌루퉁 심통 woman pouting
🙅‍♂️|안 된다는 제스처를 하는 남자|man_gesturing_no|손동작 안 돼 된다는 제스처를 하는 남자 엑스자 man gesturing NO
🙅‍♀️|안 된다는 제스처를 하는 여자|woman_gesturing_no|손동작 안 돼 된다는 제스처를 하는 여자 엑스자 woman gesturing NO
🙆‍♂️|오케이라는 제스처를 하는 남자|man_gesturing_ok|OK 손동작 오케이 오케이라는 제스처를 하는 남자 좋아 man gesturing
🙆‍♀️|오케이라는 제스처를 하는 여자|woman_gesturing_ok|OK 손동작 오케이 오케이라는 제스처를 하는 여자 좋아 woman gesturing
💁|손바닥 꺾은 사람|person_tipping_hand|데스크 안내원 손바닥 꺾은 사람 안내 person tipping hand
💁‍♂️|손바닥 꺾은 남자|man_tipping_hand|손 꺾음 손바닥 꺾은 남자 젖힌 man tipping hand
💁‍♀️|손바닥 꺾은 여자|woman_tipping_hand|손 꺾음 손바닥 꺾은 여자 젖힌 woman tipping hand
🙋‍♂️|한 손 든 남자|man_raising_hand|손들기 여기요 저요 한 손 든 남자 한손 man raising hand
🙋‍♀️|한 손 든 여자|woman_raising_hand|손들기 여기요 저요 한 손 든 여자 한손 woman raising hand
🧏|청각 장애가 있는 사람|deaf_person|귀 접근성 청각 장애가 있는 사람 청각장애 청력 deaf person
🧏‍♂️|청각장애가 있는 남자|deaf_man|남자 청각장애 청각장애가 있는 deaf man
🧏‍♀️|청각장애가 있는 여자|deaf_woman|여자 청각장애 청각장애가 있는 deaf woman
🙇|절하는 사람|person_bowing|사과하는 사람 사과하며 절하는 person bowing
🙇‍♂️|절하는 남자|man_bowing|넙죽 사과 절하는 남자 정중함 큰절 man bowing
🙇‍♀️|절하는 여자|woman_bowing|넙죽 사과 절하는 여자 정중함 큰절 woman bowing
🤦|골치 아파하는 사람|person_facepalming|골치 아파하는 사람 맙소사 손바닥 얼굴 이럴 수가 person facepalming
🤦‍♂️|골치 아파하는 남자|man_facepalming|골치 아파하는 남자 맙소사 이럴 수가 이마에 손 man facepalming
🤦‍♀️|골치 아파하는 여자|woman_facepalming|골치 아파하는 여자 맙소사 이럴 수가 이마에 손 woman facepalming
🤷‍♂️|어깨를 으쓱하는 남자|man_shrugging|글쎄 모르겠음 어깨 어깨를 으쓱하는 남자 man shrugging
🤷‍♀️|어깨를 으쓱하는 여자|woman_shrugging|글쎄 모르겠음 어깨 어깨를 으쓱하는 여자 woman shrugging
🧑‍⚕️|의료인|health_worker|간호사 의료 의료인 의사 테라피스트 health worker
👨‍⚕️|남자 의료인|man_health_worker|간호사 남자 의료 의료인 의료진 의사 진료 테라피스트 man health worker
👩‍⚕️|여자 의료인|woman_health_worker|간호사 여자 의료 의료인 의료진 의사 진료 테라피스트 woman health worker
🧑‍🎓|학생|student|졸업식 학사모 학생 student
👨‍🎓|남학생|man_student|남자 남학생 졸업식 학사모 학생 man student
👩‍🎓|여학생|woman_student|여자 여학생 졸업식 학사모 학생 woman student
🧑‍🏫|교사|teacher|강사 교사 교수 teacher
👨‍🏫|남교사|man_teacher|강사 강연자 교사 교수 남교사 남자 선생님 man teacher
👩‍🏫|여교사|woman_teacher|강사 강연자 교사 교수 선생님 여교사 여자 woman teacher
🧑‍⚖️|판사|judge|저울 판사 judge
👨‍⚖️|남자 판사|man_judge|남자 법조인 정의 판사 man judge
👩‍⚖️|여자 판사|woman_judge|법조인 여자 정의 판사 woman judge
🧑‍🌾|농부|farmer|농부 농사꾼 농장 주인 farmer
👨‍🌾|남자 농부|man_farmer|남자 농부 농사꾼 농장 주인 man farmer
👩‍🌾|여자 농부|woman_farmer|농부 농사꾼 농장 주인 여자 woman farmer
🧑‍🍳|요리사|cook|셰프 요리사 주방장 cook
👨‍🍳|남자 요리사|man_cook|남자 셰프 요리사 주방장 man cook
👩‍🍳|여자 요리사|woman_cook|셰프 여자 요리사 주방장 woman cook
🧑‍🔧|정비공|mechanic|배관공 전기 기사 정비공 mechanic
👨‍🔧|남자 정비공|man_mechanic|기술자 남자 배관공 수리공 전기 기사 정비공 man mechanic
👩‍🔧|여자 정비공|woman_mechanic|기술자 배관공 수리공 여자 전기 기사 정비공 woman mechanic
🧑‍🏭|공장 직원|factory_worker|공업 공장 조립공 직원 factory worker
👨‍🏭|공장 남자 직원|man_factory_worker|공업 공장 남자 조립공 직원 man factory worker
👩‍🏭|공장 여자 직원|woman_factory_worker|공업 공장 여자 조립공 직원 woman factory worker
🧑‍💼|회사원|office_worker|건축가 관리자 매니저 화이트칼라 회사원 office worker
👨‍💼|남자 회사원|man_office_worker|건축가 관리자 남자 회사원 매니저 비즈니스맨 화이트칼라 man office worker
👩‍💼|여자 회사원|woman_office_worker|건축가 관리자 매니저 비즈니스맨 샐러리맨 여자 회사원 화이트칼라 woman office worker
🧑‍🔬|과학자|scientist|과학자 기술자 물리학자 생물학자 화학자 scientist
👨‍🔬|남자 과학자|man_scientist|과학자 남자 물리학자 생물학자 실험 실험실 연구자 화학자 man scientist
👩‍🔬|여자 과학자|woman_scientist|과학자 물리학자 생물학자 실험 실험실 여자 연구자 화학자 woman scientist
👨‍💻|남자 기술 전문가|man_technologist|개발자 기술 전문가 남자 발명가 소프트웨어 코딩 프로그래머 man technologist
👩‍💻|여자 기술 전문가|woman_technologist|개발자 기술 전문가 발명가 소프트웨어 여자 코딩 프로그래머 woman technologist
🧑‍🎤|가수|singer|가수 노래 마이크 singer
👨‍🎤|남자 가수|man_singer|가수 남자 노래 마이크 man singer
👩‍🎤|여자 가수|woman_singer|가수 노래 마이크 여자 woman singer
🧑‍🎨|화가|artist|미술도구 아티스트 화가 artist
👨‍🎨|남자 화가|man_artist|남자 화가 미술 미술도구 아티스트 man artist
👩‍🎨|여자 화가|woman_artist|미술 미술도구 아티스트 여자 화가 woman artist
🧑‍✈️|기장|pilot|기장 비행 파일럿 pilot
👨‍✈️|남자 기장|man_pilot|기장 남자 비행 파일럿 man pilot
👩‍✈️|여자 기장|woman_pilot|기장 비행 여자 파일럿 woman pilot
🧑‍🚀|우주비행사|astronaut|로켓 우주비행사 astronaut
👨‍🚀|남자 우주비행사|man_astronaut|남자 로켓 우주비행사 우주인 man astronaut
👩‍🚀|여자 우주비행사|woman_astronaut|로켓 여자 우주비행사 우주인 woman astronaut
🧑‍🚒|소방관|firefighter|소방관 소방차 firefighter
👨‍🚒|남자 소방관|man_firefighter|구조 남자 소방관 화재 man firefighter
👩‍🚒|여자 소방관|woman_firefighter|구조 소방관 여자 화재 woman firefighter
👮|경찰관|police_officer|경찰 경찰관 police officer
👮‍♂️|남자 경찰관|man_police_officer|경찰 경찰관 경찰복 남자 man police officer
👮‍♀️|여자 경찰관|woman_police_officer|경찰 경찰관 경찰복 여자 woman police officer
🕵️|탐정|detective|스파이 탐정 형사 detective
🕵️‍♂️|남자 탐정|man_detective|남자 스파이 탐정 형사 man detective
🕵️‍♀️|여자 탐정|woman_detective|스파이 여자 여형사 탐정 형사 woman detective
💂|근위병|guard|경비대 경비대원 근위병 guard
💂‍♂️|남자 근위병|man_guard|경비대 경비대원 근위병 남자 man guard
💂‍♀️|여자 근위병|woman_guard|경비대 경비대원 근위병 여자 woman guard
🥷|닌자|ninja|닌자 몰래 하기 숨은 전투원 ninja
👷|건설 노동자|construction_worker|건설 노동자 안전모 construction worker
👷‍♂️|건설 현장 남자 노동자|man_construction_worker|건설 현장 남자 노동자 건설노동자 안전모 man construction worker
👷‍♀️|건설 현장 여자 노동자|woman_construction_worker|건설 현장 여자 노동자 건설노동자 안전모 woman construction worker
🫅|왕관을 쓴 사람|person_with_crown|군주 귀족 왕관을 쓴 사람 왕실 왕족 person with crown
🤴|왕자|prince|왕자 왕자님 프린스 prince
👸|공주|princess|공주 공주님 동화 판타지 프린세스 princess
👳|터번을 쓰고 있는 사람|person_wearing_turban|무슬림 아랍인 터번 쓴 사람 터번을 쓰고 있는 person wearing turban
👳‍♂️|터번을 쓰고 있는 남자|man_wearing_turban|무슬림 아랍인 터번 쓴 남자 터번을 쓰고 있는 man wearing turban
👳‍♀️|터번을 쓰고 있는 여자|woman_wearing_turban|무슬림 아랍인 터번 쓴 여자 터번을 쓰고 있는 woman wearing turban
👲|중국 전통 모자를 쓰고 있는 남자|person_with_skullcap|과피모 남자 모자 중국 전통 모자를 쓰고 있는 쓴 person with skullcap
🧕|머리에 스카프를 두른 여자|woman_with_headscarf|머리 스카프 머리에 스카프를 두른 여자 히잡 woman with headscarf
🤵|턱시도를 입은 사람|person_in_tuxedo|결혼식 신랑 턱시도 턱시도를 입은 사람 person in tuxedo
🤵‍♂️|턱시도를 입은 남자|man_in_tuxedo|남자 신랑 턱시도 턱시도를 입은 man in tuxedo
🤵‍♀️|턱시도를 입은 여자|woman_in_tuxedo|여자 턱시도 턱시도를 입은 woman in tuxedo
👰|면사포를 쓴 사람|person_with_veil|결혼식 면사포 면사포를 쓴 사람 신부 person with veil
👰‍♂️|면사포를 쓴 남자|man_with_veil|남자 면사포를 쓴 베일 베일을 man with veil
👰‍♀️|면사포를 쓴 여자|woman_with_veil|면사포 면사포를 쓴 여자 베일 베일을 woman with veil
🤰|임산부|pregnant_woman|여성 임산부 임신 임신부 pregnant woman
🫃|임신한 남자|pregnant_man|배 배가 터질 듯한 부푼 임신 임신한 남자 pregnant man
🫄|임신한 사람|pregnant_person|배 배가 터질 듯한 부푼 임신 임신한 사람 pregnant person
🤱|모유 수유|breast_feeding|모유 수유 아기 breast-feeding
👩‍🍼|수유 중인 여자|woman_feeding_baby|수유 중인 여자 아기 woman feeding baby
👨‍🍼|수유 중인 남자|man_feeding_baby|남자 수유 중인 아기 man feeding baby
🧑‍🍼|수유 중인 사람|person_feeding_baby|남성 부모 수유 중인 사람 아기 여성 person feeding baby
👼|아기 천사|baby_angel|아기 천사 baby angel
🎅|산타클로스|santa_claus|산타 할아버지 산타클로스 크리스마스 Santa Claus
🤶|산타할머니|mrs_claus|산타 산타클로스 산타할머니 크리스마스 Mrs. Claus
🧑‍🎄|산타|mx_claus|산타 산타클로스 크리스마스 mx claus
🦸|히로인|superhero|정의 초능력 히로인 히어로 superhero
🦸‍♂️|남자 히어로|man_superhero|남자 정의 초능력 히어로 man superhero
🦸‍♀️|여자 히어로|woman_superhero|여성 여자 히어로 정의 초능력 히로인 woman superhero
🦹|슈퍼 악당|supervillain|범죄자 빌런 슈퍼 악당 초능력 supervillain
🦹‍♂️|남자 슈퍼 악당|man_supervillain|남자 슈퍼 악당 범죄자 빌런 초능력 man supervillain
🦹‍♀️|여자 슈퍼 악당|woman_supervillain|범죄자 빌런 악당 여자 슈퍼 초능력 woman supervillain
🧙|마법사|mage|마녀 마법사 mage
🧙‍♂️|남자 마법사|man_mage|남자 마법사 man mage
🧙‍♀️|여자 마법사|woman_mage|마녀 마법사 여자 woman mage
🧚|요정|fairy|요정 fairy
🧚‍♂️|남자 요정|man_fairy|남자 요정 man fairy
🧚‍♀️|여자 요정|woman_fairy|여자 요정 woman fairy
🧛|뱀파이어|vampire|드라큘라 뱀파이어 언데드 vampire
🧛‍♂️|남자 뱀파이어|man_vampire|남자 뱀파이어 드라큘라 언데드 man vampire
🧛‍♀️|여자 뱀파이어|woman_vampire|드라큘라 언데드 여자 뱀파이어 woman vampire
🧜|인어|merperson|인어 merperson
🧜‍♂️|남자 인어|merman|남자 인어 merman
🧜‍♀️|여자 인어|mermaid|여자 인어 mermaid
🧝|엘프|elf|엘프 elf
🧝‍♂️|남자 엘프|man_elf|남자 엘프 man elf
🧝‍♀️|여자 엘프|woman_elf|여자 엘프 woman elf
🧞|지니|genie|정령 지니 genie
🧞‍♂️|남자 지니|man_genie|남자 지니 정령 man genie
🧞‍♀️|여자 지니|woman_genie|여자 지니 정령 woman genie
🧟|좀비|zombie|언데드 워킹 데드 좀비 zombie
🧟‍♂️|남자 좀비|man_zombie|남자 좀비 언데드 워킹 데드 man zombie
🧟‍♀️|여자 좀비|woman_zombie|언데드 여자 좀비 워킹데드 woman zombie
🧌|트롤|troll|괴물 동화 트롤 판타지 troll
💆|마사지 받는 사람|person_getting_massage|경락 마사지 받는 사람 person getting massage
💆‍♂️|마사지 받는 남자|man_getting_massage|관자놀이 두통 마사지 받는 남자 지압 man getting massage
💆‍♀️|마사지 받는 여자|woman_getting_massage|관자놀이 두통 마사지 받는 여자 지압 woman getting massage
💇|헤어컷|person_getting_haircut|가위와 빗 미용 헤어컷 person getting haircut
💇‍♂️|남자 헤어컷|man_getting_haircut|가위 남자 헤어컷 미용실 man getting haircut
💇‍♀️|여자 헤어컷|woman_getting_haircut|가위 미용실 여자 헤어컷 woman getting haircut
🚶|보행자|person_walking|걷는 사람 보행자 보행자용 person walking
🚶‍♂️|걷는 남자|man_walking|걷기 걷는 남자 도보 보행자 워킹 man walking
🚶‍♀️|걷는 여자|woman_walking|걷기 걷는 여자 도보 보행자 워킹 woman walking
🧍|서 있는 사람|person_standing|서 있는 사람 person standing
🧍‍♂️|서 있는 남자|man_standing|남자 서 있는 man standing
🧍‍♀️|서 있는 여자|woman_standing|서 있는 여자 woman standing
🧎|무릎을 꿇은 사람|person_kneeling|무릎을 꿇은 사람 person kneeling
🧎‍♂️|무릎을 꿇은 남자|man_kneeling|남자 무릎을 꿇은 man kneeling
🧎‍♀️|무릎을 꿇은 여자|woman_kneeling|무릎을 꿇은 여자 woman kneeling
🧑‍🦯|지팡이를 든 사람|person_with_white_cane|시각장애 접근성 지팡이를 든 사람 person with white cane
👨‍🦯|지팡이를 든 남자|man_with_white_cane|남자 시각장애 접근성 지팡이를 든 man with white cane
👩‍🦯|지팡이를 든 여자|woman_with_white_cane|시각장애 여자 접근성 지팡이를 든 woman with white cane
🧑‍🦼|전동 휠체어를 탄 사람|person_in_motorized_wheelchair|전동 휠체어 휠체어를 탄 사람 접근성 person in motorized wheelchair
👨‍🦼|전동 휠체어를 탄 남자|man_in_motorized_wheelchair|남자 전동 휠체어를 탄 접근성 휠체어 man in motorized wheelchair
👩‍🦼|전동 휠체어를 탄 여자|woman_in_motorized_wheelchair|여자 전동 휠체어를 탄 접근성 휠체어 woman in motorized wheelchair
🧑‍🦽|수동 휠체어를 탄 사람|person_in_manual_wheelchair|수동 휠체어 휠체어를 탄 사람 접근성 person in manual wheelchair
👨‍🦽|수동 휠체어를 탄 남자|man_in_manual_wheelchair|남자 수동 휠체어를 탄 접근성 휠체어 man in manual wheelchair
👩‍🦽|수동 휠체어를 탄 여자|woman_in_manual_wheelchair|수동 휠체어를 탄 여자 접근성 휠체어 woman in manual wheelchair
🏃‍♂️|뛰는 남자|man_running|달리기 뛰기 뛰는 남자 런닝 마라톤 man running
🏃‍♀️|뛰는 여자|woman_running|달리기 뛰기 뛰는 여자 런닝 마라톤 woman running
💃|여자 댄서|woman_dancing|댄서 댄스 댄싱 여성 여자 춤 춤추는 woman dancing
🕺|남자 댄서|man_dancing|남성 남자 댄서 댄스 댄싱 춤 춤추는 man dancing
🕴️|공중에 떠 있는 정장 입은 남자|person_in_suit_levitating|공중부양 공중에 떠 있는 정장 입은 남자 person in suit levitating
👯|토끼 귀를 쓰고 춤추는 사람들|people_with_bunny_ears|토끼 귀를 쓰고 춤추는 사람들 쓴 여자 people with bunny ears
👯‍♂️|토끼 귀를 쓰고 춤추는 남자들|men_with_bunny_ears|댄서 두 남자 토끼 귀 귀를 쓰고 춤추는 남자들 men with bunny ears
👯‍♀️|토끼 귀를 쓰고 춤추는 여자들|women_with_bunny_ears|댄서 두 여자 토끼 귀 귀를 쓰고 춤추는 여자들 women with bunny ears
🧖|사우나 하는 사람|person_in_steamy_room|사우나 하는 사람 person in steamy room
🧖‍♂️|사우나 하는 남자|man_in_steamy_room|사우나 하는 남자 man in steamy room
🧖‍♀️|사우나 하는 여자|woman_in_steamy_room|사우나 하는 여자 woman in steamy room
🧗|클라이밍하는 사람|person_climbing|클라이밍 클라이밍하는 사람 person climbing
🧗‍♂️|클라이밍하는 남자|man_climbing|클라이밍 클라이밍하는 남자 man climbing
🧗‍♀️|클라이밍하는 여자|woman_climbing|클라이밍 클라이밍하는 여자 woman climbing
🤺|펜싱하는 사람|person_fencing|검 선수 스포츠 펜싱 펜싱하는 사람 person fencing
🏇|승마|horse_racing|말 말과 기수 스포츠 승마 horse racing
⛷️|스키 타는 사람|skier|스키 타는 사람 스키타는 skier
🏂|스노보드 타는 사람|snowboarder|스노보더 스노보드 타는 사람 스포츠 운동 snowboarder
🏌️|골프치는 사람|person_golfing|골프 골프치는 사람 공 필드 person golfing
🏌️‍♂️|골프치는 남자|man_golfing|골프 골프선수 골프치는 남자 스윙 man golfing
🏌️‍♀️|골프치는 여자|woman_golfing|골프 골프선수 골프치는 여자 스윙 woman golfing
🏄|서핑하는 사람|person_surfing|서퍼 서핑하는 사람 스포츠 person surfing
🏄‍♂️|서핑하는 남자|man_surfing|서퍼 서핑 서핑보드 서핑하는 남자 수상스포츠 man surfing
🏄‍♀️|서핑하는 여자|woman_surfing|서퍼 서핑 서핑보드 서핑하는 여자 수상스포츠 woman surfing
🚣|노젓는 사람|person_rowing_boat|노 젓는 보트 노젓는 사람 person rowing boat
🚣‍♂️|노젓는 남자|man_rowing_boat|노 노젓기 노젓는 남자 배 보트 man rowing boat
🚣‍♀️|노젓는 여자|woman_rowing_boat|노 노젓기 노젓는 여자 배 보트 woman rowing boat
🏊‍♂️|수영하는 남자|man_swimming|수영 수영선수 수영장 수영하는 남자 헤엄 man swimming
🏊‍♀️|수영하는 여자|woman_swimming|수영 수영선수 수영장 수영하는 여자 헤엄 woman swimming
⛹️|공을 갖고 있는 사람|person_bouncing_ball|공을 갖고 있는 사람 농구 농구공 농구선수 person bouncing ball
⛹️‍♂️|공 가진 남자|man_bouncing_ball|공 가진 남자 공놀이 man bouncing ball
⛹️‍♀️|공 가진 여자|woman_bouncing_ball|공 가진 여자 공놀이 woman bouncing ball
🏋️|역도 선수|person_lifting_weights|역도 선수 역도선수 person lifting weights
🏋️‍♂️|남자 역도 선수|man_lifting_weights|남자 역도 선수 역도선수 man lifting weights
🏋️‍♀️|여자 역도 선수|woman_lifting_weights|여자 역도 선수 역도선수 woman lifting weights
🚴‍♂️|자전거 타는 남자|man_biking|바이커 바이킹 선수 자전거 타는 남자 man biking
🚴‍♀️|자전거 타는 여자|woman_biking|바이커 바이킹 선수 자전거 타는 여자 woman biking
🚵|산악 자전거 타는 사람|person_mountain_biking|산악 자전거 주행 타는 사람 person mountain biking
🚵‍♂️|산악 자전거 타는 남자|man_mountain_biking|남자 사이클링 산 산악 자전거 타는 man mountain biking
🚵‍♀️|산악 자전거 타는 여자|woman_mountain_biking|사이클링 산 산악 자전거 타는 여자 woman mountain biking
🤸|옆돌기하는 사람|person_cartwheeling|옆돌기 옆돌기하는 사람 체조 풍차돌리기 person cartwheeling
🤸‍♂️|옆돌기하는 남자|man_cartwheeling|옆돌기 옆돌기하는 남자 체조 풍차돌리기 man cartwheeling
🤸‍♀️|옆돌기하는 여자|woman_cartwheeling|옆돌기 옆돌기하는 여자 체조 풍차돌리기 woman cartwheeling
🤼|레슬링하는 사람|people_wrestling|레슬러 레슬링 선수 레슬링하는 사람 스포츠 people wrestling
🤼‍♂️|레슬링하는 남자|men_wrestling|레슬러 레슬링 레슬링하는 남자 시합 men wrestling
🤼‍♀️|레슬링하는 여자|women_wrestling|레슬러 레슬링 레슬링하는 여자 시합 women wrestling
🤽|수구하는 사람|person_playing_water_polo|수구 수구하는 사람 스포츠 워터폴로 person playing water polo
🤽‍♂️|수구하는 남자|man_playing_water_polo|수구 수구하는 남자 수상스포츠 수영복 워터폴로 man playing water polo
🤽‍♀️|수구하는 여자|woman_playing_water_polo|수구 수구하는 여자 수상스포츠 수영복 워터폴로 woman playing water polo
🤾|핸드볼하는 사람|person_playing_handball|구기종목 선수 스포츠 핸드볼 핸드볼하는 사람 person playing handball
🤾‍♂️|핸드볼하는 남자|man_playing_handball|구기종목 스포츠 핸드볼 핸드볼하는 남자 man playing handball
🤾‍♀️|핸드볼하는 여자|woman_playing_handball|구기종목 스포츠 핸드볼 핸드볼하는 여자 woman playing handball
🤹|저글링하는 사람|person_juggling|저글 저글링 저글링하는 사람 person juggling
🤹‍♂️|저글링하는 남자|man_juggling|저글 저글링 저글링하는 남자 man juggling
🤹‍♀️|저글링하는 여자|woman_juggling|저글 저글링 저글링하는 여자 woman juggling
🧘‍♂️|가부좌한 남자|man_in_lotus_position|가부좌 가부좌한 남자 요가 man in lotus position
🧘‍♀️|가부좌한 여자|woman_in_lotus_position|가부좌 가부좌한 여자 요가 woman in lotus position
🛀|목욕하는 사람|person_taking_bath|목욕하는 사람 욕조 person taking bath
🛌|침대에 누운 사람|person_in_bed|침대 침대에 누운 사람 호텔 person in bed
🧑‍🤝‍🧑|손을 잡고 있는 두 명의 사람|people_holding_hands|사람 손 손을 잡고 있는 두 명의 커플 people holding hands
👭|손을 잡고 있는 두 명의 여자|women_holding_hands|동성 연인 커플 손을 잡고 있는 두 명의 여자 여성 친구들 women holding hands
👫|손을 잡고 있는 남녀|woman_and_man_holding_hands|남녀 커플 손을 잡고 있는 연인 woman and man holding hands
👬|손을 잡고 있는 두 명의 남자|men_holding_hands|남성 커플 동성 연인 손을 잡고 있는 두 명의 남자 친구들 men holding hands
💏|키스|kiss|사랑 연애 키스 kiss
👩‍❤️‍💋‍👨|키스: 여자 남자|kiss_woman_man|남자 사랑 여자 연애 키스 키스: kiss: woman, man
👨‍❤️‍💋‍👨|키스: 남자 남자|kiss_man_man|남자 사랑 연애 키스 키스: kiss: man, man
👩‍❤️‍💋‍👩|키스: 여자 여자|kiss_woman_woman|사랑 여자 연애 키스 키스: kiss: woman, woman
💑|연인|couple_with_heart|사랑 연애 중 연인 couple with heart
👩‍❤️‍👨|연인: 여자 남자|couple_with_heart_woman_man|남자 사랑 여자 연애 중 연인 연인: couple with heart: woman, man
👨‍❤️‍👨|연인: 남자 남자|couple_with_heart_man_man|남자 사랑 연애 중 연인 연인: couple with heart: man, man
👩‍❤️‍👩|연인: 여자 여자|couple_with_heart_woman_woman|사랑 여자 연애 중 연인 연인: couple with heart: woman, woman
👨‍👩‍👦|가족: 남자 여자 남자 아이|family_man_woman_boy|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, woman, boy
👨‍👩‍👧‍👦|가족: 남자 여자 여자 아이 남자 아이|family_man_woman_girl_boy|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, woman, girl, boy
👨‍👩‍👦‍👦|가족: 남자 여자 남자 아이 남자 아이|family_man_woman_boy_boy|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, woman, boy, boy
👨‍👩‍👧‍👧|가족: 남자 여자 여자 아이 여자 아이|family_man_woman_girl_girl|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, woman, girl, girl
👨‍👨‍👦|가족: 남자 남자 남자 아이|family_man_man_boy|가족 가족: 남자 아이 사람들 아빠 엄마 family: man, boy
👨‍👨‍👧|가족: 남자 남자 여자 아이|family_man_man_girl|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, girl
👨‍👨‍👧‍👦|가족: 남자 남자 여자 아이 남자 아이|family_man_man_girl_boy|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, girl, boy
👨‍👨‍👦‍👦|가족: 남자 남자 남자 아이 남자 아이|family_man_man_boy_boy|가족 가족: 남자 아이 사람들 아빠 엄마 family: man, boy, boy
👨‍👨‍👧‍👧|가족: 남자 남자 여자 아이 여자 아이|family_man_man_girl_girl|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, girl, girl
👩‍👩‍👦|가족: 여자 여자 남자 아이|family_woman_woman_boy|가족 가족: 여자 남자 아이 사람들 아빠 엄마 family: woman, boy
👩‍👩‍👧|가족: 여자 여자 여자 아이|family_woman_woman_girl|가족 가족: 여자 아이 사람들 아빠 엄마 family: woman, girl
👩‍👩‍👧‍👦|가족: 여자 여자 여자 아이 남자 아이|family_woman_woman_girl_boy|가족 가족: 여자 아이 남자 사람들 아빠 엄마 family: woman, girl, boy
👩‍👩‍👦‍👦|가족: 여자 여자 남자 아이 남자 아이|family_woman_woman_boy_boy|가족 가족: 여자 남자 아이 사람들 아빠 엄마 family: woman, boy, boy
👩‍👩‍👧‍👧|가족: 여자 여자 여자 아이 여자 아이|family_woman_woman_girl_girl|가족 가족: 여자 아이 사람들 아빠 엄마 family: woman, girl, girl
👨‍👦|가족: 남자 남자 아이|family_man_boy|가족 가족: 남자 아이 사람들 아빠 엄마 family: man, boy
👨‍👦‍👦|가족: 남자 남자 아이 남자 아이|family_man_boy_boy|가족 가족: 남자 아이 사람들 아빠 엄마 family: man, boy, boy
👨‍👧|가족: 남자 여자 아이|family_man_girl|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, girl
👨‍👧‍👦|가족: 남자 여자 아이 남자 아이|family_man_girl_boy|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, girl, boy
👨‍👧‍👧|가족: 남자 여자 아이 여자 아이|family_man_girl_girl|가족 가족: 남자 여자 아이 사람들 아빠 엄마 family: man, girl, girl
👩‍👦|가족: 여자 남자 아이|family_woman_boy|가족 가족: 여자 남자 아이 사람들 아빠 엄마 family: woman, boy
👩‍👦‍👦|가족: 여자 남자 아이 남자 아이|family_woman_boy_boy|가족 가족: 여자 남자 아이 사람들 아빠 엄마 family: woman, boy, boy
👩‍👧|가족: 여자 여자 아이|family_woman_girl|가족 가족: 여자 아이 사람들 아빠 엄마 family: woman, girl
👩‍👧‍👦|가족: 여자 여자 아이 남자 아이|family_woman_girl_boy|가족 가족: 여자 아이 남자 사람들 아빠 엄마 family: woman, girl, boy
👩‍👧‍👧|가족: 여자 여자 아이 여자 아이|family_woman_girl_girl|가족 가족: 여자 아이 사람들 아빠 엄마 family: woman, girl, girl
🗣️|말하고 있는 옆얼굴|speaking_head|말하고 있는 옆얼굴 말함 실루엣 얼굴 speaking head
👤|사람 그림자|bust_in_silhouette|사람 그림자 상반신 상체 bust in silhouette
👥|사람들 그림자|busts_in_silhouette|사람들 그림자 상반신 상체 busts in silhouette
🫂|포옹하는 사람|people_hugging|고마워 안녕 잘 가 포옹 포옹하는 사람 people hugging
👪|가족|family|가족 사람들 아빠 아이 엄마 family
👣|발자국|footprints|발 발바닥 발자국 족적 footprints`),
  },
  {
    id: "animal",
    label: "동물",
    icon: "🐶",
    items: parse(`
🐶|강아지|dog|개 강아지 멍멍 얼굴 개띠 동물 dog face
🐱|고양이|cat|고양이 야옹 얼굴 동물 cat face
🐭|쥐|mouse|쥐 얼굴 동물 쥐띠 mouse face
🐰|토끼|rabbit|토끼 얼굴 동물 토끼띠 rabbit face
🦊|여우|fox_face|여우 얼굴 동물 fox
🐻|곰|bear|곰 얼굴 곰돌이 동물 bear
🐼|판다|panda_face|판다 얼굴 동물 판다곰 panda
🐨|코알라|koala|코알라 동물 koala
🐯|호랑이|tiger|호랑이 얼굴 동물 호랑이띠 tiger face
🦁|사자|lion|사자 얼굴 lion
🐮|소|cow|소 얼굴 동물 소띠 cow face
🐷|돼지|pig|돼지 얼굴 동물 돼지띠 pig face
🐸|개구리|frog|개구리 얼굴 동물 frog
🐵|원숭이|monkey_face|원숭이 얼굴 동물 원숭이띠 monkey face
🐔|닭|chicken|닭 동물 암탉 치킨 chicken
🐧|펭귄|penguin|펭귄 동물 penguin
🐦|새|bird|새 동물 bird
🦋|나비|butterfly|나비 곤충 날개 butterfly
🐢|거북|turtle|거북 느림 거북이 동물 turtle
🐳|고래|whale|고래 바다 물 뿜는 동물 spouting whale
🐟|물고기|fish|물고기 생선 동물 fish
🐝|꿀벌|bee|벌 꿀 부지런 꿀벌 동물 honeybee
🌸|벚꽃|cherry_blossom|꽃 봄 벚꽃 꽃송이 cherry blossom
🌻|해바라기|sunflower|꽃 여름 해바라기 sunflower
🌳|나무|deciduous_tree|나무 숲 자연 낙엽수 deciduous tree
🍀|네잎클로버|four_leaf_clover|행운 클로버 네잎클로버 four leaf clover
🌵|선인장|cactus|선인장 사막 나무 식물 cactus
🍁|단풍잎|maple_leaf|단풍 가을 단풍잎 이파리 잎 잎사귀 maple leaf
🐒|원숭이|monkey|동물 원숭이 monkey
🦍|고릴라|gorilla|고릴라 동물 gorilla
🦧|오랑우탄|orangutan|오랑우탄 유인원 orangutan
🐕|개|dog|강아지 개 개새끼 동물 멍멍이 dog
🦮|안내견|guide_dog|시각장애 안내견 접근성 guide dog
🐕‍🦺|보조견|service_dog|보조 보조견 접근성 service dog
🐩|푸들|poodle|개 개새끼 동물 멍멍이 푸들 poodle
🐺|늑대 얼굴|wolf|늑대 얼굴 동물 wolf
🦝|너구리|raccoon|너구리 장난기 있는 호기심 raccoon
🐈|고양이|cat|고양이 괭이 냐옹이 동물 야옹이 집사 cat
🐈‍⬛|검은 고양이|black_cat|검은 고양이 불길한 불행 black cat
🐅|호랑이|tiger|동물 타이거 호랑이 tiger
🐆|표범|leopard|동물 레오파드 표범 leopard
🐴|말 얼굴|horse_face|동물 말 얼굴 말띠 horse face
🐎|말|horse|동물 레이스 말 horse
🦄|유니콘 얼굴|unicorn|얼굴 유니콘 unicorn
🦓|얼룩말|zebra|얼룩말 줄무늬 zebra
🦌|사슴|deer|동물 사슴 deer
🦬|들소|bison|들소 떼 물소 bison
🐂|소|ox|동물 소 황소 ox
🐃|물소|water_buffalo|동물 물소 버팔로 소 water buffalo
🐄|젖소|cow|동물 소 젖소 cow
🐖|돼지|pig|꿀꿀이 동물 돼지 pig
🐗|멧돼지|boar|동물 돼지 멧돼지 피그 boar
🐽|돼지코|pig_nose|동물 돼지코 코 pig nose
🐏|숫양|ram|동물 숫양 ram
🐑|양|ewe|동물 양 ewe
🐐|염소|goat|동물 염소 goat
🐪|낙타|camel|낙타 단봉 동물 camel
🐫|쌍봉 낙타|two_hump_camel|동물 쌍봉 낙타 two-hump camel
🦙|라마|llama|과나코 라마 비큐나 알파카 울 llama
🦒|기린|giraffe|기린 giraffe
🐘|코끼리|elephant|동물 코끼리 elephant
🦣|매머드|mammoth|매머드 멸종 상아 큰 털북숭이 mammoth
🦏|코뿔소|rhinoceros|동물 코뿔소 rhinoceros
🦛|하마|hippopotamus|동물 하마 hippopotamus
🐁|생쥐|mouse|동물 생쥐 흰쥐 mouse
🐀|쥐|rat|동물 생쥐 쥐 rat
🐹|햄스터 얼굴|hamster|동물 햄스터 얼굴 hamster
🐇|토끼|rabbit|동물 토깽이 토끼 rabbit
🐿️|얼룩다람쥐|chipmunk|다람쥐 얼룩다람쥐 chipmunk
🦫|비버|beaver|댐 비버 beaver
🦔|고슴도치|hedgehog|가시 고슴도치 hedgehog
🦇|박쥐|bat|박쥐 뱀파이어 bat
🐻‍❄️|북극곰|polar_bear|곰 백곰 북극 북극곰 흰곰 polar bear
🦥|나무늘보|sloth|게으른 나무늘보 느린 sloth
🦦|수달|otter|물고기 사냥 수달 장난꾸러기 otter
🦨|스컹크|skunk|냄새나는 스컹크 skunk
🦘|캥거루|kangaroo|새끼 캥거루 점프 호주 kangaroo
🦡|오소리|badger|벌꿀오소리 심술쟁이 오소리 badger
🐾|곰발바닥|paw_prints|곰발바닥 곰발자국 동물 paw prints
🦃|칠면조|turkey|새 칠면조 터키 turkey
🐓|수탉|rooster|동물 수탉 rooster
🐣|알에서 깬 병아리|hatching_chick|갓 태어난 병아리 동물 알에서 깬 hatching chick
🐤|병아리|baby_chick|동물 병아리 아기 baby chick
🐥|정면을 향해 날개를 편 병아리|front_facing_baby_chick|동물 아기 병아리 정면을 향해 날개를 편 front-facing baby chick
🕊️|비둘기|dove|비둘기 새 평화 dove
🦅|독수리|eagle|독수리 새 조류 eagle
🦆|오리|duck|새 오리 조류 duck
🦢|백조|swan|못난 아기 오리 백조 새끼 조류 swan
🦉|부엉이|owl|부엉이 새 올빼미 조류 owl
🦤|도도새|dodo|도도새 멸종 모리셔스 큰 새 dodo
🪶|깃털|feather|가벼운 깃털 비행 새 feather
🦩|홍학|flamingo|열대 플라밍고 홍학 flamingo
🦚|공작|peacock|공작 뽐내는 수컷 조류 화려한 peacock
🦜|앵무새|parrot|말하는 새 앵무새 조류 해적 parrot
🐊|악어|crocodile|동물 악어 crocodile
🦎|도마뱀|lizard|도마뱀 동물 파충류 lizard
🐍|뱀|snake|동물 뱀 snake
🐲|용 얼굴|dragon_face|동물 드래곤 용 얼굴 용띠 dragon face
🐉|용|dragon|동물 드래곤 용 dragon
🦕|초식 공룡|sauropod|뇌룡 초식 공룡 sauropod
🦖|티라노사우루스|t_rex|티라노사우루스 티렉스 T-Rex
🐋|고래|whale|고래 동물 whale
🐬|돌고래|dolphin|돌고래 동물 dolphin
🦭|물개|seal|물개 바다사자 seal
🐠|열대어|tropical_fish|동물 물고기 열대어 tropical fish
🐡|복어|blowfish|동물 물고기 복어 blowfish
🦈|상어|shark|바다생물 상어 어류 shark
🐙|문어|octopus|동물 문어 점쟁이 페드로 octopus
🐚|달팽이집|spiral_shell|달팽이 껍질 달팽이집 동물 spiral shell
🪸|산호초|coral|대양 산호초 암초 coral
🐌|달팽이|snail|곤충 달팽이 동물 벌레 snail
🐛|송충이|bug|동물 벌레 송충이 bug
🐜|개미|ant|개미 곤충 벌레 ant
🪲|딱정벌레|beetle|곤충 딱정벌레 벌레 beetle
🐞|무당벌레|lady_beetle|동물 무당벌레 벌레 lady beetle
🦗|귀뚜라미|cricket|귀뚜라미 cricket
🪳|바퀴벌레|cockroach|곤충 바퀴벌레 벌레 해충 cockroach
🕷️|거미|spider|거미 곤충 벌레 스파이더 spider
🕸️|거미줄|spider_web|거미 거미줄 spider web
🦂|전갈|scorpion|스콜피온 전갈 scorpion
🦟|모기|mosquito|말라리아 모기 바이러스 벌레 병균 열 mosquito
🪰|파리|fly|구더기 부패 질병 파리 해충 fly
🪱|지렁이|worm|기생충 지렁이 환형동물 worm
🦠|미생물|microbe|미생물 바이러스 박테리아 아메바 microbe
💐|꽃다발|bouquet|꽃 꽃다발 부케 bouquet
💮|흰 꽃|white_flower|꽃 도장 표시 흰 white flower
🪷|연꽃|lotus|꽃 베트남 불교 순수 연꽃 인도 힌두교 lotus
🏵️|장미|rosette|꽃 장미 rosette
🌹|장미꽃|rose|꽃 장미꽃 rose
🥀|시든 꽃|wilted_flower|꺾인 고개 꽃 시든 시듦 wilted flower
🌺|무궁화|hibiscus|꽃 무궁화 hibiscus
🌼|꽃송이|blossom|꽃 꽃송이 blossom
🌷|튤립|tulip|꽃 튤립 tulip
🌱|새싹|seedling|새싹 싹이 돋다 seedling
🪴|분재|potted_plant|분재 식물 자라다 지루한 집 키우다 potted plant
🌲|소나무|evergreen_tree|나무 상록수 소나무 evergreen tree
🌴|야자수|palm_tree|나무 야자수 열대 palm tree
🌾|벼|sheaf_of_rice|벼 벼이삭 이삭 sheaf of rice
🌿|풀|herb|잎 잎사귀 풀 herb
☘️|토끼풀|shamrock|세잎 토끼풀 풀 shamrock
🍂|낙엽|fallen_leaf|낙엽 단풍잎 이파리 잎 잎사귀 fallen leaf
🍃|바람에 흔들리는 나뭇잎|leaf_fluttering_in_wind|가을 낙엽 바람에 떨어지는 잎 흔들리는 나뭇잎 leaf fluttering in wind
🪹|빈 둥지|empty_nest|둥지 빈 새둥우리 empty nest
🪺|알이 들어 있는 둥지|nest_with_eggs|둥지 새둥우리 알이 들어 있는 nest with eggs
🍄|버섯|mushroom|나무 버섯 식물 mushroom`),
  },
  {
    id: "food",
    label: "음식",
    icon: "🍎",
    items: parse(`
🍎|사과|apple|사과 과일 빨간 red apple
🍊|귤|tangerine|귤 오렌지 과일 밀감 tangerine
🍋|레몬|lemon|레몬 과일 lemon
🍌|바나나|banana|바나나 과일 banana
🍉|수박|watermelon|수박 여름 과일 watermelon
🍇|포도|grapes|포도 과일 grapes
🍓|딸기|strawberry|딸기 과일 strawberry
🍑|복숭아|peach|복숭아 과일 peach
🥑|아보카도|avocado|아보카도 과일 식품 아보카드 열매 avocado
🥕|당근|carrot|당근 채소 식품 carrot
🌽|옥수수|corn|옥수수 농작물 식물 콘 ear of corn
🍞|빵|bread|빵 식빵 bread
🧀|치즈|cheese|치즈 조각 덩어리 cheese wedge
🍳|달걀 프라이|fried_egg|계란 요리 아침 프라이팬 프라이 cooking
🍔|햄버거|hamburger|햄버거 패스트푸드 버거 hamburger
🍕|피자|pizza|피자 조각 한 pizza
🍜|라면|ramen|라면 국수 면 steaming bowl
🍣|초밥|sushi|초밥 회 스시 일식 sushi
🍚|밥|rice|밥 쌀 식사 밥공기 cooked rice
🍙|주먹밥|rice_ball|주먹밥 삼각김밥 삼각 김밥 밥 rice ball
🍰|케이크|cake|케이크 디저트 조각 케익 쇼트케이크 조각케이크 shortcake
🎂|생일 케이크|birthday|생일 케이크 축하 생일케이크 birthday cake
🍩|도넛|doughnut|도넛 디저트 초코 doughnut
🍪|쿠키|cookie|쿠키 과자 초코 초코칩 cookie
☕|커피|coffee|커피 카페 차 뜨거운 음료 hot beverage
🍵|녹차|tea|차 녹차 찻잔 찻집 teacup without handle
🍺|맥주|beer|맥주 술 맥주잔 맥주컵 술집 호프 beer mug
🍷|와인|wine_glass|와인 술 와인잔 와인글라스 와인바 wine glass
🍈|멜론|melon|과일 멜론 야채 채소 melon
🍍|파인애플|pineapple|과일 파인애플 pineapple
🥭|망고|mango|과일 망고 열대 mango
🍏|초록 사과|green_apple|과일 초록 사과 파란 green apple
🍐|배|pear|과일 배 pear
🍒|체리|cherries|과일 체리 cherries
🫐|블루베리|blueberries|베리 블루베리 월귤나무 blueberries
🥝|키위|kiwi_fruit|과일 식품 키위 kiwi fruit
🍅|토마토|tomato|채소 토마토 tomato
🫒|올리브|olive|올리브 음식 olive
🥥|코코넛|coconut|코코넛 coconut
🍆|가지|eggplant|가지 야채 채소 eggplant
🥔|감자|potato|감자 식품 채소 포테이토 potato
🌶️|홍고추|hot_pepper|고추 빨간 홍고추 hot pepper
🫑|피망|bell_pepper|고추 채소 피망 후추 bell pepper
🥒|오이|cucumber|식품 오이 채소 피클 cucumber
🥬|녹색 채소|leafy_green|녹색 채소 상추 양배추 청경채 케일 leafy green
🥦|브로콜리|broccoli|브로콜리 broccoli
🧄|마늘|garlic|마늘 조미료 garlic
🧅|양파|onion|양념 양파 onion
🥜|땅콩|peanuts|견과류 넛츠 땅콩 식품 peanuts
🫘|콩|beans|신장 음식 콩 콩류 콩팥 beans
🌰|밤|chestnut|견과류 나무 밤 식물 chestnut
🥐|크루아상|croissant|빵 식품 크루아상 프랑스 croissant
🥖|바게트|baguette_bread|바게트 빵 식품 프랑스 baguette bread
🫓|플랫브레드|flatbread|난 라바쉬 아레파 플랫브레드 피타 flatbread
🥨|프레첼|pretzel|프레첼 pretzel
🥯|베이글|bagel|베이글 빵 슈미어 bagel
🥞|팬케이크|pancakes|식품 크레페 팬케이크 핫케이크 pancakes
🧇|와플|waffle|와플 waffle
🍖|고기|meat_on_bone|고기 덩어리 meat on bone
🍗|닭다리|poultry_leg|고기 닭고기 닭다리 poultry leg
🥩|고깃덩이|cut_of_meat|고깃덩이 스테이크 cut of meat
🥓|베이컨|bacon|고기 돼지고기 베이컨 식품 bacon
🍟|감자튀김|french_fries|감자튀김 패스트푸드 프렌치 프라이 french fries
🌭|핫도그|hot_dog|소세지 핫도그 hot dog
🥪|샌드위치|sandwich|빵 샌드위치 sandwich
🌮|타코|taco|멕시코 요리 타코 taco
🌯|부리또|burrito|멕시코 요리 버리토 부리또 타코 burrito
🫔|타말레|tamale|감싼 멕시칸 타말레 tamale
🥙|밀전병에 싼 요리|stuffed_flatbread|밀전병에 싼 요리 부리또 stuffed flatbread
🧆|팔라펠|falafel|미트볼 병아리콩 팔라펠 falafel
🥚|달걀|egg|계란 달걀 식품 egg
🥘|납작한 냄비|shallow_pan_of_food|납작한 냄비 빠에야 음식 찌개 캐서롤 shallow pan of food
🍲|국|pot_of_food|국 찌개 탕 pot of food
🫕|퐁듀|fondue|냄비 녹다 스위스 초콜릿 치즈 퐁듀 fondue
🥣|스푼과 사발|bowl_with_spoon|스푼과 사발 시리얼 아침 콘지 bowl with spoon
🥗|야채샐러드|green_salad|건강 샐러드 야채 야채샐러드 채소 green salad
🍿|팝콘|popcorn|영화 팝콘 popcorn
🧈|버터|butter|버터 유제품 butter
🧂|소금|salt|소금 양념통 조미료 salt
🥫|통조림|canned_food|캔 통조림 canned food
🍱|도시락|bento_box|도시락 밥 벤또 bento box
🍘|주먹밥|rice_cracker|밥 주먹밥 rice cracker
🍛|카레라이스|curry_rice|카레 카레라이스 카레밥 curry rice
🍝|스파게티|spaghetti|면 스파게티 파스타 spaghetti
🍠|고구마|roasted_sweet_potato|고구마 삶은 찐 roasted sweet potato
🍢|오뎅|oden|어묵 어묵꼬치 오뎅 오뎅꼬치 oden
🍤|새우튀김|fried_shrimp|새우 새우튀김 튀김 fried shrimp
🍥|어묵|fish_cake_with_swirl|꽃모양 어묵 오뎅 fish cake with swirl
🥮|월병|moon_cake|가을 명절 월병 moon cake
🍡|떡꼬치|dango|꼬치 당고 디저트 떡 떡꼬치 dango
🥟|만두|dumpling|교자 덤플링 만두 dumpling
🥠|포츈 쿠키|fortune_cookie|포춘 쿠키 포츈 fortune cookie
🥡|테이크아웃 상자|takeout_box|테이크아웃 상자 takeout box
🦀|꽃게|crab|게 꽃게 크랩 crab
🦞|바닷가재|lobster|가재 바닷가재 집게발 해산물 lobster
🦐|새우|shrimp|갑각류 바다생물 새우 식품 shrimp
🦑|오징어|squid|식품 연체동물 오징어 squid
🦪|굴|oyster|굴 진주 oyster
🍦|소프트 아이스크림|soft_ice_cream|소프트 아이스크림 콘 soft ice cream
🍧|샤베트 아이스크림|shaved_ice|샤베트 아이스크림 shaved ice
🍨|아이스크림|ice_cream|떠먹는 아이스크림 ice cream
🧁|컵케이크|cupcake|디저트 베이커리 컵케이크 cupcake
🥧|파이|pie|파이 패스트리 pie
🍫|초콜렛|chocolate_bar|초코 초코바 초콜렛 chocolate bar
🍬|사탕|candy|사탕 캔디 candy
🍭|롤리팝|lollipop|롤리팝 막대 사탕 lollipop
🍮|커스타드 푸딩|custard|디저트 커스타드 푸딩 custard
🍯|꿀|honey_pot|꿀 꿀단지 honey pot
🍼|젖병|baby_bottle|아기 젖병 우유 baby bottle
🥛|우유 한잔|glass_of_milk|글라스 밀크 우유 한잔 glass of milk
🫖|찻주전자|teapot|냄비 음료 차 찻주전자 teapot
🍶|사케|sake|병과 술잔 사케 술 sake
🍾|코르크가 튀어나오고 있는 병|bottle_with_popping_cork|와인 와인병 코르크 코르크가 튀어나오고 있는 병 bottle with popping cork
🍸|칵테일|cocktail_glass|칵테일 칵테일글라스 칵테일바 칵테일잔 cocktail glass
🍹|음료수|tropical_drink|바 음료수 tropical drink
🍻|맥주|clinking_beer_mugs|맥주 맥주잔 짠 clinking beer mugs
🥂|건배하는 샴페인 잔|clinking_glasses|건배 건배하는 샴페인 잔 clinking glasses
🥃|양주잔|tumbler_glass|샷 양주잔 위스키 tumbler glass
🫗|쏟아져 나오는 액체|pouring_liquid|비어 있는 쏟아져 나오는 액체 유리잔 음료 흘림 pouring liquid
🥤|빨대와 컵|cup_with_straw|빨대와 컵 소다 주스 cup with straw
🧋|버블티|bubble_tea|버블 버블티 우유 차 펄 bubble tea
🧃|음료 팩|beverage_box|음료 팩 쥬스 beverage box
🧉|마테차|mate|마테차 음료 차 mate
🧊|얼음|ice|각얼음 얼음 차가운 ice
🥢|젓가락|chopsticks|젓가락 chopsticks
🍽️|포크와 나이프가 있는 접시|fork_and_knife_with_plate|나이프 접시 포크 포크와 나이프가 있는 fork and knife with plate
🍴|포크와 나이프|fork_and_knife|나이프 식당 포크 포크와 fork and knife
🥄|숟가락|spoon|수저 숟가락 스푼 식기 주방용품 테이블웨어 spoon
🔪|식칼|kitchen_knife|식칼 요리용 칼 kitchen knife
🫙|작은 병|jar|보관 비어 있는 소스 양념 용기 작은 병 저장 jar
🏺|암포라|amphora|단지 암포라 amphora`),
  },
  {
    id: "activity",
    label: "활동",
    icon: "⚽",
    items: parse(`
⚽|축구공|soccer|축구 공 운동 축구공 soccer ball
🏀|농구공|basketball|농구 운동 농구공 스포츠 basketball
⚾|야구공|baseball|야구 운동 야구공 공 baseball
🎾|테니스|tennis|테니스 운동 스포츠 공 tennis
🏐|배구공|volleyball|배구 배구공 volleyball
🏓|탁구|ping_pong|탁구 탁구공 탁구채 ping pong
🏸|배드민턴|badminton|배드민턴 배드민턴채 셔틀콕 badminton
⛳|골프|golf|골프 구멍 flag in hole
🏊|수영|swimmer|수영 운동 수영하는 사람 선수 수영장 스포츠 person swimming
🚴|자전거 타기|bicyclist|자전거 운동 타는 사람 주행 person biking
🧘|명상|lotus_position|명상 요가 휴식 가부좌한 사람 가부좌 person in lotus position
🎯|과녁|dart|목표 정답 과녁 명중 양궁 화살 bullseye
🎮|게임|video_game|게임 오락 비디오 컨트롤러 게임패드 video game
🎲|주사위|game_die|주사위 게임 운 game die
🧩|퍼즐|jigsaw|퍼즐 조각 조각퍼즐 직소퍼즐 puzzle piece
🎨|팔레트|art|그림 미술 디자인 팔레트 그리기 artist palette
🎬|영화|clapper|영화 촬영 슬레이트 클래퍼보드 clapper board
🎤|마이크|microphone|노래 발표 마이크 가라오케 노래방 행사 microphone
🎧|헤드폰|headphones|음악 듣기 헤드폰 감상 이어폰 headphone
🎵|음표|musical_note|음악 노래 음표 musical note
🎸|기타|guitar|기타 악기 연주 음악 통기타 guitar
🏆|트로피|trophy|우승 상 트로피 trophy
🥇|금메달|1st_place_medal|1등 금메달 골드 메달 일등 1st place medal
🎉|축하|tada|축하 파티 폭죽 party popper
🎁|선물|gift|선물 생일 포장 축하 wrapped gift
🎈|풍선|balloon|풍선 파티 축하 balloon
🎃|할로윈|jack_o_lantern|할로윈 장식 호박 핼러윈 jack-o-lantern
🎄|크리스마스 트리|christmas_tree|크리스마스 트리 Christmas tree
🎆|불꽃놀이|fireworks|불꽃 축제 불꽃놀이 축하 fireworks
🎇|불꽃|sparkler|불꽃 축제 축하 폭죽 sparkler
🧨|폭죽|firecracker|다이너마이트 불꽃놀이 폭약 폭죽 firecracker
🎊|박 터트리기|confetti_ball|기념 박 터트리기 축하 confetti ball
🎋|소원을 건 나무|tanabata_tree|기원 쪽지 소원 빌기 매달기 소원을 건 나무 tanabata tree
🎍|일본 장식|pine_decoration|일본 장식 축하 pine decoration
🎎|일본 인형|japanese_dolls|남녀 인형 일본 Japanese dolls
🎏|물고기 깃발|carp_streamer|물고기 깃발 모양 장식 carp streamer
🎐|풍경|wind_chime|종 풍경 wind chime
🎑|달맞이|moon_viewing_ceremony|달 달맞이 행사 벼이삭 moon viewing ceremony
🧧|세뱃돈|red_envelope|돈 봉투 선물 세뱃돈 행운 현금 red envelope
🎀|리본|ribbon|리본 축하 ribbon
🎗️|추모 리본|reminder_ribbon|기념 리본 추모 reminder ribbon
🎟️|입장 티켓|admission_tickets|입장 티켓 admission tickets
🎫|티켓|ticket|공연 엔터테인먼트 티켓 표 ticket
🎖️|무공 훈장|military_medal|메달 무공 훈장 military medal
🏅|스포츠 메달|sports_medal|경기 메달 스포츠 sports medal
🥈|은메달|2nd_place_medal|메달 실버 은메달 이등 2nd place medal
🥉|동메달|3rd_place_medal|동메달 메달 브론즈 삼등 3rd place medal
🥎|소프트볼|softball|공 소프트볼 야구공 softball
🏈|미식축구공|american_football|미식축구 미식축구공 스포츠 운동 american football
🏉|럭비공|rugby_football|럭비 럭비공 스포츠 운동 rugby football
🥏|원반|flying_disc|야외 운동 원반 flying disc
🎳|볼링|bowling|볼링 게임 볼링공 볼링핀 bowling
🏏|크리켓|cricket_game|공 운동 크리켓 cricket game
🏑|필드 하키|field_hockey|필드 하키 스틱 field hockey
🏒|아이스 하키와 퍽|ice_hockey|아이스 하키 하키와 퍽 스틱 ice hockey
🥍|라크로스|lacrosse|골 그물채 라크로스 스틱 lacrosse
🥊|권투 글러브|boxing_glove|권투 글러브 복싱 스포츠 boxing glove
🥋|도복|martial_arts_uniform|가라데 도복 유니폼 유도 태권도 합기도 martial arts uniform
🥅|골대|goal_net|골대 구기종목 네트 스포츠 goal net
⛸️|아이스 스케이트|ice_skate|스케이트 아이스 ice skate
🎣|낚싯대|fishing_pole|낚시 낚싯대 물고기 fishing pole
🤿|다이빙 마스크|diving_mask|다이빙 마스크 스노클링 스킨스쿠버 diving mask
🎽|러닝 셔츠|running_shirt|러닝 셔츠 민소매 상의 운동복 running shirt
🎿|스키|skis|스키 부츠 스포츠 운동 skis
🛷|썰매|sled|눈썰매 썰매 sled
🥌|컬링 스톤|curling_stone|컬링 스톤 curling stone
🪀|요요|yo_yo|오르락내리락 요요 장난감 yo-yo
🪁|연|kite|연 연날리기 활공 kite
🔫|물총|water_pistol|권총 물총 총 water pistol
🎱|당구|pool_8_ball|당구 게임 당구공 pool 8 ball
🔮|수정 구슬|crystal_ball|구슬 수정 예언 운세 crystal ball
🪄|마술 지팡이|magic_wand|마녀 마법사 마술 지팡이 magic wand
🕹️|조이스틱|joystick|게임 비디오 조이스틱 조종대 joystick
🎰|슬롯 머신|slot_machine|게임 슬롯 머신 파칭코 slot machine
🧸|테디 베어|teddy_bear|곰인형 솜인형 장난감 테디 베어 teddy bear
🪅|피냐타|pi_ata|축하 파티 피냐타 piñata
🪩|미러볼|mirror_ball|댄스 디스코 미러볼 반짝반짝 춤 파티 mirror ball
🪆|네스팅 인형|nesting_dolls|네스팅 인형 러시아 마트료시카 nesting dolls
♠️|스페이드|spade_suit|스페이드 카드 게임 spade suit
♥️|하트|heart_suit|카드 게임 하트 heart suit
♦️|다이아몬드|diamond_suit|다이아몬드 카드 게임 diamond suit
♣️|클럽|club_suit|카드 게임 클럽 club suit
♟️|체스 폰|chess_pawn|소모품 체스 말 폰 chess pawn
🃏|조커|joker|조커 카드 joker
🀄|마작|mahjong_red_dragon|마작 기호 mahjong red dragon
🎴|화투|flower_playing_cards|고스톱 도박 화투 화투패 flower playing cards
🎭|가면|performing_arts|가면 공연 마스크 영화관 예술 performing arts
🖼️|그림 액자|framed_picture|그림 박물관 액자 작품 framed picture
🧵|실타래|thread|뜨개질 바느질 바늘 실 실타래 thread
🪡|바늘|sewing_needle|바느질 바늘 봉합 자수 재단 sewing needle
🧶|실뭉치|yarn|니트 실뭉치 코바늘 yarn
🪢|매듭|knot|꼬인 노끈 매듭 밧줄 엉킨 knot`),
  },
  {
    id: "travel",
    label: "여행",
    icon: "✈️",
    items: parse(`
✈️|비행기|airplane|비행기 여행 출장 비행 항공 airplane
🚗|자동차|car|자동차 차 운전 승용차 차량 automobile
🚕|택시|taxi|택시 자동차 taxi
🚌|버스|bus|버스 교통 교통수단 차 bus
🚇|지하철|metro|지하철 교통 메트로 전철 metro
🚄|고속열차|bullettrain_side|기차 KTX 열차 고속열차 케이티엑스 high-speed train
🚲|자전거|bike|자전거 교통수단 바이크 bicycle
🚀|로켓|rocket|로켓 출시 시작 빠름 로케트 발사 우주 rocket
⛵|돛단배|boat|배 바다 돛단배 범선 요트 sailboat
🏠|집|house|집 홈 건물 주택 house
🏢|회사 건물|office|회사 사무실 건물 빌딩 오피스 office building
🏫|학교|school|학교 공부 건물 빌딩 스쿨 school
🏥|병원|hospital|병원 건물 메디컬 빌딩 의사 hospital
🏖️|해변|beach_umbrella|바다 해변 휴가 파라솔이 있는 파라솔 beach with umbrella
⛰️|산|mountain|산 등산 정상 mountain
🏕️|캠핑|camping|캠핑 텐트 camping
🗺️|지도|world_map|지도 여행 세계 world map
📍|위치|round_pushpin|위치 장소 핀 둥근 머리 압정 round pushpin
🌍|지구|earth_africa|지구 세계 유럽과 아프리카가 보이는 아프리카 유럽 지구본 globe showing Europe-Africa
☀️|해|sunny|해 맑음 날씨 태양 더움 sun
🌙|달|crescent_moon|달 밤 초승달 crescent moon
⭐|별|star|별 중요 star
🌈|무지개|rainbow|무지개 레인보우 rainbow
☔|비|umbrella|비 우산 날씨 빗방울이 있는 강우 강한 umbrella with rain drops
❄️|눈송이|snowflake|눈 겨울 눈송이 추위 snowflake
⚡|번개|zap|번개 전기 빠름 고압 주의 경고 high voltage
🔥|불|fire|불 핫 인기 열정 불꽃 화재 fire
🌎|미대륙이 보이는 지구|globe_showing_americas|미대륙 미대륙이 보이는 지구 미주 세계 지구본 globe showing Americas
🌏|아시아와 호주가 보이는 지구|globe_showing_asia_australia|아시아 아시아와 호주가 보이는 지구 지구본 호주 globe showing Asia-Australia
🌐|자오선 지구|globe_with_meridians|경도 위도 자오선 지구 globe with meridians
🗾|일본 지도|map_of_japan|일본 지도 map of Japan
🧭|나침반|compass|나침반 오리엔티어링 자석 compass
🏔️|눈 덮인 산|snow_capped_mountain|눈 덮인 산 설산 snow-capped mountain
🌋|화산|volcano|화산 폭발 volcano
🗻|후지산|mount_fuji|산 후지산 mount fuji
🏜️|사막|desert|사막 선인장 태양 desert
🏝️|사막 섬|desert_island|사막 섬 desert island
🏞️|국립공원|national_park|공원 국립 국립공원 national park
🏟️|경기장|stadium|경기장 스타디움 stadium
🏛️|고전 양식의 건축물|classical_building|건물 고전 양식의 건축물 classical building
🏗️|건물 공사|building_construction|건물 공사 building construction
🧱|벽돌|brick|담벼락 벽돌 빨간 brick
🪨|바위|rock|단단한 돌 무거운 바위 rock
🪵|목재|wood|목재 수목 재목 통나무 wood
🛖|오두막|hut|오두막 원실 유르트 집 hut
🏘️|주택 건물|houses|건물 주택 houses
🏚️|낡은 주택 건물|derelict_house|건물 낡은 주택 노후 derelict house
🏡|정원이 있는 집|house_with_garden|정원이 있는 주택 집 house with garden
🏣|일본 우체국|japanese_post_office|건물 우체국 일본 Japanese post office
🏤|우체국|post_office|우체국 유럽 post office
🏦|은행|bank|건물 뱅크 빌딩 은행 bank
🏨|호텔|hotel|건물 숙박 잠 호텔 hotel
🏩|모텔|love_hotel|러브 호텔 모텔 love hotel
🏪|편의점|convenience_store|가게 편의점 convenience store
🏬|백화점|department_store|가게 백화점 department store
🏭|공장|factory|건물 공장 빌딩 factory
🏯|일본 성|japanese_castle|궁전 성 일본 히메지성 Japanese castle
🏰|유럽 성|castle|궁전 성 유럽 castle
💒|결혼식|wedding|결혼 결혼식 교회 성당 wedding
🗼|도쿄 타워|tokyo_tower|도쿄 타워 탑 Tokyo tower
🗽|자유의 여신상|statue_of_liberty|여신상 자유 자유의 Statue of Liberty
⛪|교회|church|건물 교회 빌딩 크리스찬 church
🕌|모스크|mosque|모스크 사원 이슬람 종교 mosque
🛕|힌두교 사원|hindu_temple|사원 힌두교 hindu temple
🕍|시나고그|synagogue|사원 시나고그 유대교 종교 synagogue
⛩️|신토 신사|shinto_shrine|신사 신토 일본 종교 shinto shrine
🕋|카바|kaaba|이슬람 종교 카바 kaaba
⛲|분수|fountain|분수 분수대 fountain
⛺|텐트|tent|캠프 캠핑 텐트 tent
🌁|자욱한 안개|foggy|날씨 스모그 자욱한 안개 foggy
🌃|밤하늘 별|night_with_stars|밤하늘 별 야경 night with stars
🏙️|도시 전경|cityscape|건물 도시 전경 cityscape
🌄|산에서 떠오르는 해|sunrise_over_mountains|산 산에 해가 뜸 산에서 떠오르는 해 아침 sunrise over mountains
🌅|일출|sunrise|아침 해 일출 해가 뜸 sunrise
🌆|도시 야경|cityscape_at_dusk|건물 도시 야경 일몰 저녁 해질녘 cityscape at dusk
🌇|일몰|sunset|도시에 해가 짐 일몰 해질녘 sunset
🌉|밤하늘을 배경으로 하는 다리|bridge_at_night|다리 달과 밤 밤의 밤하늘을 배경으로 하는 별과 bridge at night
♨️|온천|hot_springs|뜨거움 목욕탕 온천 hot springs
🎠|회전 목마|carousel_horse|놀이공원 목마 유원지 회전 carousel horse
🛝|미끄럼틀|playground_slide|놀이 놀이공원 미끄럼틀 playground slide
🎡|관람차|ferris_wheel|관람차 놀이공원 유원지 ferris wheel
🎢|롤러코스터|roller_coaster|놀이공원 롤러코스터 유원지 roller coaster
💈|이발소|barber_pole|이발사 이발소 표시 barber pole
🎪|서커스|circus_tent|서커스 텐트 circus tent
🚂|기관차|locomotive|교통수단 기관차 기차 엔진 트레인 locomotive
🚃|전철|railway_car|교통수단 엔진 전철 철도 트레인 railway car
🚅|고속철|bullet_train|KTX 고속철 케이티엑스 bullet train
🚆|기차|train|기차 철도 train
🚈|경전철|light_rail|경전철 교통수단 기차 light rail
🚉|기차역|station|기차역 역 전철역 지하철역 station
🚊|트램|tram|전차 트램 tram
🚝|모노레일|monorail|교통수단 기차 모노레일 monorail
🚞|기차 터널|mountain_railway|기차 산터널 터널 mountain railway
🚋|트램 차량|tram_car|전차 차량 트램 tram car
🚍|오고 있는 버스|oncoming_bus|버스 오고 있는 oncoming bus
🚎|트롤리 버스|trolleybus|버스 트롤리 trolleybus
🚐|미니버스|minibus|미니버스 소형 버스 minibus
🚑|구급차|ambulance|구급차 앰뷸런스 ambulance
🚒|소방차|fire_engine|소방차 엔진 트럭 화재 fire engine
🚓|경찰차|police_car|경찰 경찰차 police car
🚔|오고 있는 경찰차|oncoming_police_car|경찰 경찰차 오고 있는 oncoming police car
🚖|오고 있는 택시|oncoming_taxi|오고 있는 택시 oncoming taxi
🚘|오고 있는 자동차|oncoming_automobile|오고 있는 승용차 자동차 oncoming automobile
🚙|지프|sport_utility_vehicle|SUV 지프 지프차 sport utility vehicle
🛻|픽업트럭|pickup_truck|트럭 픽업 픽업트럭 pickup truck
🚚|운송 트럭|delivery_truck|운송 차량 트럭 delivery truck
🚛|트레일러 트럭|articulated_lorry|트레일러 트럭 articulated lorry
🚜|트랙터|tractor|교통수단 차량 트랙터 tractor
🏎️|경주용 자동차|racing_car|경주용 자동차 레이싱카 racing car
🏍️|오토바이|motorcycle|경주 모터사이클 오토바이 motorcycle
🛵|스쿠터|motor_scooter|스쿠터 오토바이 전동 motor scooter
🦽|수동 휠체어|manual_wheelchair|수동 휠체어 접근성 manual wheelchair
🦼|전동 휠체어|motorized_wheelchair|전동 휠체어 접근성 motorized wheelchair
🛺|경삼륜차|auto_rickshaw|경삼륜차 툭툭 auto rickshaw
🛴|킥보드|kick_scooter|씽씽카 킥보드 kick scooter
🛹|스케이트보드|skateboard|보드 스케이트보드 skateboard
🛼|롤러스케이트|roller_skate|롤러 롤러스케이트 스케이트 roller skate
🚏|버스 정류장|bus_stop|버스 정류장 bus stop
🛣️|고속도로|motorway|고속도로 도로 motorway
🛤️|철도 선로|railway_track|선로 철도 railway track
🛢️|기름통|oil_drum|기름 기름통 드럼 oil drum
⛽|주유소|fuel_pump|가스 경유 연료 주유소 휘발유 fuel pump
🛞|휠|wheel|원 타이어 회전 휠 wheel
🚨|사이렌|police_car_light|경찰차 사이렌 삐용삐용 police car light
🚥|가로 신호등|horizontal_traffic_light|가로 수평 신호등 horizontal traffic light
🚦|세로 신호등|vertical_traffic_light|세로 수직 신호등 vertical traffic light
🛑|멈춤 표시|stop_sign|교통신호 멈춤 표시 팔각형 stop sign
🚧|공사 중|construction|공사 중 표시 construction
⚓|닻|anchor|닻 앵커 항해 anchor
🛟|구명부환|ring_buoy|구명 기구 튜브 구명부환 구조 구조원 부낭 안전 ring buoy
🛶|카누|canoe|배 카누 canoe
🚤|쾌속정|speedboat|보트 선박 쾌속정 speedboat
🛳️|여객선|passenger_ship|배 선박 여객선 passenger ship
⛴️|페리|ferry|보트 연락선 페리 ferry
🛥️|모터보트|motor_boat|모터보트 보트 motor boat
🚢|선박|ship|바다 배 선박 ship
🛩️|경비행기|small_airplane|경비행기 비행기 소형비행기 small airplane
🛫|비행기 이륙|airplane_departure|비행기 이륙 출발 airplane departure
🛬|비행기 착륙|airplane_arrival|도착 비행기 착륙 airplane arrival
🪂|낙하산|parachute|낙하산 스카이다이빙 패러세일링 행글라이더 parachute
💺|좌석|seat|자리 좌석 seat
🚁|헬리콥터|helicopter|헬기 헬리콥터 helicopter
🚟|매달린 케이블카|suspension_railway|매달린 케이블카 suspension railway
🚠|산악 케이블카|mountain_cableway|곤돌라 교통수단 산 산악 케이블카 mountain cableway
🚡|케이블카|aerial_tramway|곤돌라 공중 케이블카 산악 aerial tramway
🛰️|인공위성|satellite|우주 인공위성 satellite
🛸|비행접시|flying_saucer|UFO 비행접시 flying saucer
🛎️|호출 벨|bellhop_bell|데스크벨 벨 호출 호텔 bellhop bell
🧳|여행용 가방|luggage|여행 여행용 가방 짐 luggage
⏳|시간이 남은 모래시계|hourglass_not_done|시간이 남은 모래시계 타이머 hourglass not done
⌚|시계|watch|손목 시계 watch
⏱️|스톱워치|stopwatch|스톱워치 시계 stopwatch
⏲️|타이머 시계|timer_clock|시계 타이머 timer clock
🕰️|벽난로 선반 시계|mantelpiece_clock|벽난로 선반 시계 mantelpiece clock
🕛|열두 시|twelve_o_clock|12 12:00 12시 시계 열두 시 twelve o’clock
🕧|열두 시 반|twelve_thirty|12:30 12시 30분 시계 열두 시 반 twelve-thirty
🕐|한 시|one_o_clock|1 1:00 1시 시계 한 시 one o’clock
🕜|한 시 반|one_thirty|1:30 1시 30분 시계 한 시 반 one-thirty
🕑|두 시|two_o_clock|2 2:00 2시 두 시 시계 two o’clock
🕝|두 시 반|two_thirty|2:30 2시 30분 두 시 반 시계 two-thirty
🕒|세 시|three_o_clock|3 3:00 3시 세 시 시계 three o’clock
🕞|세 시 반|three_thirty|3:30 3시 30분 세 시 반 시계 three-thirty
🕓|네 시|four_o_clock|4 4:00 4시 네 시 시계 four o’clock
🕟|네 시 반|four_thirty|4:30 4시 30분 네 시 반 시계 four-thirty
🕔|다섯 시|five_o_clock|5 5:00 5시 다섯 시 시계 five o’clock
🕠|다섯 시 반|five_thirty|5:30 5시 30분 다섯 시 반 시계 five-thirty
🕕|여섯 시|six_o_clock|6 6:00 6시 시계 여섯 시 six o’clock
🕡|여섯 시 반|six_thirty|6:30 6시 30분 시계 여섯 시 반 six-thirty
🕖|일곱 시|seven_o_clock|7 7:00 7시 시계 일곱 시 seven o’clock
🕢|일곱 시 반|seven_thirty|7:30 7시 30분 시계 일곱 시 반 seven-thirty
🕗|여덟 시|eight_o_clock|8 8:00 8시 시계 여덟 시 eight o’clock
🕣|여덟 시 반|eight_thirty|8:30 8시 30분 시계 여덟 시 반 eight-thirty
🕘|아홉 시|nine_o_clock|9 9:00 9시 시계 아홉 시 nine o’clock
🕤|아홉 시 반|nine_thirty|9:30 9시 30분 시계 아홉 시 반 nine-thirty
🕙|열 시|ten_o_clock|10 10:00 10시 시계 열 시 ten o’clock
🕥|열 시 반|ten_thirty|10:30 10시 30분 시계 열 시 반 ten-thirty
🕚|열한 시|eleven_o_clock|11 11:00 11시 시계 열한 시 eleven o’clock
🕦|열한 시 반|eleven_thirty|11:30 11시 30분 시계 열한 시 반 eleven-thirty
🌑|삭|new_moon|그믐 그믐달 뉴문 달 삭 초승달 new moon
🌒|초승달 상현|waxing_crescent_moon|달 상현 상현달 초승달 waxing crescent moon
🌓|오른쪽 반달|first_quarter_moon|달 오른쪽 반달 first quarter moon
🌔|상현달|waxing_gibbous_moon|달 상현달 waxing gibbous moon
🌕|보름달|full_moon|달 보름달 full moon
🌖|하현달|waning_gibbous_moon|달 하현달 waning gibbous moon
🌗|왼쪽 반달|last_quarter_moon|달 왼쪽 반달 last quarter moon
🌘|그믐달 하현|waning_crescent_moon|그믐달 하현 달 waning crescent moon
🌚|얼굴이 있는 삭|new_moon_face|뉴문 달 달님 삭 얼굴이 있는 new moon face
🌛|얼굴이 있는 초승달|first_quarter_moon_face|달 달님 얼굴이 있는 초승달 first quarter moon face
🌜|그믐달|last_quarter_moon_face|그믐달 달 달님 얼굴이 있는 last quarter moon face
🌡️|온도계|thermometer|온도 온도계 thermometer
🌝|얼굴이 있는 보름달|full_moon_face|달 달님 얼굴이 있는 보름달 full moon face
🌞|얼굴이 있는 해|sun_with_face|얼굴이 있는 해 방긋 해님 sun with face
🪐|고리가 있는 행성|ringed_planet|고리가 있는 행성 토성 ringed planet
🌟|반짝이는 별|glowing_star|반짝이는 별 반짝이다 반짝임 glowing star
🌠|별똥별|shooting_star|낙성 떨어지는 별 별똥별 유성 shooting star
🌌|은하수|milky_way|우주 은하 은하수 행성 milky way
☁️|구름|cloud|구름 흐림 cloud
⛅|구름 뒤의 해|sun_behind_cloud|구름 뒤의 해 구름에 가린 sun behind cloud
⛈️|번개가 치는 비구름|cloud_with_lightning_and_rain|구름 번개 번개가 치는 비구름 비 cloud with lightning and rain
🌤️|작은 구름 뒤의 태양|sun_behind_small_cloud|구름 작은 뒤의 태양 해 흐림 sun behind small cloud
🌥️|큰 구름 뒤의 태양|sun_behind_large_cloud|구름 큰 뒤의 태양 해 흐림 sun behind large cloud
🌦️|비구름 뒤의 태양|sun_behind_rain_cloud|구름 비 비구름 뒤의 태양 해 sun behind rain cloud
🌧️|비구름|cloud_with_rain|구름 비 비구름 cloud with rain
🌨️|눈구름|cloud_with_snow|구름 날씨 눈 눈구름 cloud with snow
🌩️|번개구름|cloud_with_lightning|구름 번개 번개구름 cloud with lightning
🌪️|토네이도|tornado|소용돌이 태풍 토네이도 tornado
🌫️|안개|fog|구름 물결표시 안개 fog
🌬️|얼굴이 있는 바람|wind_face|바람 얼굴 얼굴이 있는 wind face
🌀|태풍|cyclone|사이클론 소용돌이 태풍 태풍의 눈 cyclone
🌂|접힌 우산|closed_umbrella|비 접힌 우산 closed umbrella
☂️|우산|umbrella|비 우산 umbrella
⛱️|땅에 꽂힌 파라솔|umbrella_on_ground|땅에 꽂힌 파라솔 우산 해변가 umbrella on ground
☃️|눈사람|snowman|겨울 눈 눈사람 추위 snowman
⛄|스노우맨|snowman_without_snow|겨울 눈 스노우맨 snowman without snow
☄️|혜성|comet|우주 혜성 comet
💧|물방울|droplet|땀 물방울 droplet
🌊|파도|water_wave|물결 파도 풍랑 water wave`),
  },
  {
    id: "object",
    label: "사물",
    icon: "💡",
    items: parse(`
💡|전구|bulb|아이디어 생각 전구 기발한 아하 light bulb
📌|압정|pushpin|고정 중요 핀 압정 pushpin
📎|클립|paperclip|클립 첨부 종이 paperclip
📝|메모|memo|메모 기록 노트 글쓰기 메모장 메모지 memo
📒|공책|ledger|공책 노트 원장 ledger
📚|책|books|책 공부 독서 여러 권 books
📅|달력|date|달력 일정 날짜 캘린더 calendar
⏰|알람 시계|alarm_clock|알람 시간 시계 alarm clock
⌛|모래시계|hourglass|시간 대기 시간이 다 된 모래시계 모래 타이머 hourglass done
📞|전화|telephone_receiver|전화 통화 수화기 telephone receiver
📱|휴대폰|iphone|휴대폰 스마트폰 휴대전화 모바일폰 mobile phone
💻|노트북|computer|컴퓨터 노트북 업무 PC 랩탑 laptop
⌨️|키보드|keyboard|키보드 입력 keyboard
🖨️|프린터|printer|프린터 인쇄 인쇄기 printer
📷|카메라|camera|카메라 사진 촬영 camera
🔍|돋보기|mag|검색 찾기 왼쪽으로 향한 돋보기 검색하기 magnifying glass tilted left
🔑|열쇠|key|열쇠 비밀번호 패스워드 key
🔒|자물쇠|lock|잠금 보안 자물쇠 락 locked
✉️|편지|envelope|편지 메일 봉투 이메일 envelope
📦|상자|package|상자 택배 배송 소포 꾸러미 박스 package
💰|돈 주머니|moneybag|돈 비용 돈주머니 돈가방 주머니 money bag
💳|카드|credit_card|카드 결제 신용카드 credit card
🛒|장바구니|shopping_cart|쇼핑 장보기 쇼핑카트 카트 shopping cart
🧾|영수증|receipt|영수증 지출 기록 증빙 회계 receipt
🔧|렌치|wrench|수리 도구 설정 렌치 wrench
🗑️|휴지통|wastebasket|삭제 휴지통 쓰레기통 wastebasket
🎓|학사모|mortar_board|졸업 학교 공부 모자 졸업생 졸업식 graduation cap
👓|안경|glasses|눈 안경 glasses
🕶️|선글라스|sunglasses|선글라스 안경 sunglasses
🥽|고글|goggles|고글 물안경 수영 안경 안구 보호 장비 용접 goggles
🥼|실험실 가운|lab_coat|과학자 실험실 가운 의사 lab coat
🦺|구명조끼|safety_vest|구명조끼 안전 응급 조끼 safety vest
👔|넥타이|necktie|넥타이 샐러리맨 타이 necktie
👕|티셔츠|t_shirt|티 티셔츠 t-shirt
👖|바지|jeans|면바지 바지 청바지 jeans
🧣|스카프|scarf|스카프 scarf
🧤|장갑|gloves|장갑 gloves
🧥|코트|coat|재킷 코트 coat
🧦|양말|socks|양말 socks
👗|원피스|dress|드레스 원피스 dress
👘|기모노|kimono|기모노 일본 kimono
🥻|사리|sari|드레스 사리 의복 sari
🩱|원피스 수영복|one_piece_swimsuit|수영복 원피스 one-piece swimsuit
🩲|삼각 수영복|briefs|삼각 수영복 언더웨어 briefs
🩳|반바지|shorts|반바지 수영복 shorts
👙|비키니|bikini|비키니 수영복 bikini
👚|여성복|woman_s_clothes|블라우스 여성복 woman’s clothes
👛|지갑|purse|동전 지갑 purse
👜|핸드백|handbag|가방 백 핸드백 handbag
👝|파우치|clutch_bag|가방 파우치 clutch bag
🛍️|쇼핑백|shopping_bags|쇼핑가방 쇼핑백 shopping bags
🎒|학교 가방|backpack|가방 학교 학생 backpack
🩴|가락신|thong_sandal|가락신 가죽 끈 비치 샌들 조리 thong sandal
👞|남성용 구두|man_s_shoe|구두 남성용 신발 man’s shoe
👟|운동화|running_shoe|스니커즈 신발 운동화 running shoe
🥾|등산화|hiking_boot|등산 등산화 부츠 캠핑 하이킹 hiking boot
🥿|플랫 슈즈|flat_shoe|단화 발레 슈즈 플랫 flat shoe
👠|하이힐|high_heeled_shoe|구두 신발 여성용 하이힐 high-heeled shoe
👡|샌들|woman_s_sandal|샌들 신발 여성용 woman’s sandal
🩰|발레 슈즈|ballet_shoes|발레 슈즈 춤 ballet shoes
👢|부츠|woman_s_boot|부츠 신발 여성용 woman’s boot
👑|왕관|crown|왕 왕관 왕족 crown
👒|여성용 모자|woman_s_hat|모자 여성용 챙 넓은 woman’s hat
🎩|마술사 모자|top_hat|마술사 모자 top hat
🧢|야구모자|billed_cap|야구모자 billed cap
🪖|군용 헬멧|military_helmet|군대 군용 군인 전사 헬멧 military helmet
⛑️|흰 십자가가 있는 헬멧|rescue_worker_s_helmet|도움 모자 안전요원 헬멧 흰 십자가가 있는 rescue worker’s helmet
📿|묵주|prayer_beads|기도 묵주 예배 prayer beads
💄|립스틱|lipstick|립스틱 화장 화장품 lipstick
💍|반지|ring|다이아몬드 반지 링 ring
💎|원석|gem_stone|다이아몬드 보석 원석 gem stone
🔇|무음|muted_speaker|무음 소리 끄기 없음 muted speaker
🔈|스피커|speaker_low_volume|소리 있음 스피커 speaker low volume
🔉|스피커 소리 작게|speaker_medium_volume|소리 작게 작음 줄이기 스피커 speaker medium volume
🔊|스피커 소리 크게|speaker_high_volume|소리 크게 큼 키우기 스피커 speaker high volume
📢|확성기|loudspeaker|메가폰 확성기 loudspeaker
📣|메가폰|megaphone|메가폰 응원 megaphone
📯|호른|postal_horn|악기 호른 postal horn
🔔|종|bell|벨 종 bell
🔕|음소거|bell_with_slash|소리 금지 없음 음소거 bell with slash
🎼|높은음자리표|musical_score|높은음자리 높은음자리표 악보 음악 musical score
🎶|노래 음표|musical_notes|노래 음표 음악 musical notes
🎙️|스튜디오 마이크|studio_microphone|마이크 사회자 스튜디오 studio microphone
🎚️|레벨 슬라이더|level_slider|레벨 슬라이더 음악 level slider
🎛️|컨트롤 레버|control_knobs|조작 레버 컨트롤 control knobs
📻|라디오|radio|FM 라디오 radio
🎷|색소폰|saxophone|색소폰 악기 연주 음악 saxophone
🪗|아코디언|accordion|아코디언 콘서티나 accordion
🎹|피아노|musical_keyboard|건반 악기 연주 음악 피아노 musical keyboard
🎺|트럼펫|trumpet|악기 연주 음악 트럼펫 trumpet
🎻|바이올린|violin|바이올린 악기 연주 음악 violin
🪕|밴조|banjo|밴조 음악 현악기 banjo
🥁|드럼|drum|드럼 북 북채 음악 drum
🪘|긴 북|long_drum|긴 북 드럼 리듬 박자 콩가 long drum
📲|왼쪽에 화살표가 있는 휴대전화|mobile_phone_with_arrow|모바일폰 왼쪽에 화살표가 있는 휴대전화 통화 휴대폰 mobile phone with arrow
☎️|전화기|telephone|유선전화 전화기 telephone
📟|삐삐|pager|삐삐 호출기 pager
📠|팩스|fax_machine|팩스 팩스기 팩시밀리 fax machine
🔋|배터리|battery|건전지 배터리 충전 battery
🪫|배터리 부족|low_battery|배터리 부족 전기 low battery
🔌|전기 플러그|electric_plug|전기 플러그 electric plug
🖥️|데스크톱 컴퓨터|desktop_computer|데스크톱 컴퓨터 desktop computer
🖱️|컴퓨터 마우스|computer_mouse|마우스 컴퓨터 computer mouse
🖲️|트랙볼|trackball|마우스 컴퓨터 트랙볼 trackball
💽|엠디|computer_disk|MD 디스크 미니 엠디 computer disk
💾|플로피 디스크|floppy_disk|디스켓 플로피 디스크 floppy disk
💿|씨디|optical_disk|CD DVD 광학 디스크 디비디 블루레이 씨디 optical disk
📀|디비디|dvd|DVD 디비디 dvd
🧮|주판|abacus|암산 주판 abacus
🎥|영화 카메라|movie_camera|영화 카메라 촬영 movie camera
🎞️|영화 프레임|film_frames|영화 프레임 필름 film frames
📽️|영화 프로젝터|film_projector|무비 영화 프로젝터 film projector
📺|텔레비전|television|TV 텔레비전 티비 television
📸|플래시를 터트리고 있는 카메라|camera_with_flash|카메라 플래시 플래시를 터트리고 있는 camera with flash
📹|캠코더|video_camera|동영상 촬영 비디오 카메라 캠코더 video camera
📼|비디오테이프|videocassette|비디오 비디오테이프 테이프 videocassette
🔎|오른쪽으로 향한 돋보기|magnifying_glass_tilted_right|검색 검색하기 오른쪽으로 향한 돋보기 magnifying glass tilted right
🕯️|양초|candle|양초 캔들 candle
🔦|손전등|flashlight|손전등 전등 flashlight
🏮|일본식 등|red_paper_lantern|선술집 이자카야 일본식 등 홍등 red paper lantern
🪔|기름 램프|diya_lamp|기름 디야 램프 diya lamp
📔|표지가 있는 노트|notebook_with_decorative_cover|공책 노트 표지가 있는 notebook with decorative cover
📕|펼치지 않은 책|closed_book|도서 책 펼치지 않은 closed book
📖|펼쳐진 책|open_book|책 펼쳐진 open book
📗|초록색 책|green_book|녹색 책 초록색 green book
📘|파란색 책|blue_book|책 파란 파란색 blue book
📙|주황색 책|orange_book|오렌지색 책 주황색 orange book
📓|공책|notebook|공책 노트 notebook
📃|안으로 말린 문서|page_with_curl|안으로 말린 문서 페이지 page with curl
📜|문서|scroll|문서 스크롤 scroll
📄|오른쪽 모서리가 접힌 문서|page_facing_up|오른쪽 모서리가 접힌 문서 페이지 page facing up
📰|신문|newspaper|소식 신문 정보 newspaper
🗞️|돌돌 말린 신문|rolled_up_newspaper|돌돌 말린 신문 뭉치 rolled-up newspaper
📑|북마크 탭|bookmark_tabs|마커 북마크 탭 포스트잇 bookmark tabs
🔖|북마크|bookmark|마크 북마크 책갈피 표시 bookmark
🏷️|라벨|label|라벨 택 label
🪙|동전|coin|금 금속 돈 동전 보물 은 coin
💴|엔|yen_banknote|엔 엔화 일본 돈 화폐 yen banknote
💵|달러|dollar_banknote|달러 달러화 미국 돈 화폐 dollar banknote
💶|유로|euro_banknote|유럽 돈 화폐 유로 유로화 euro banknote
💷|파운드|pound_banknote|영국 돈 화폐 파운드 파운드화 pound banknote
💸|날개 달린 돈|money_with_wings|날개 달린 돈 날아가는 날림 손해 지폐 money with wings
💹|엔화 관련 상승하는 그래프|chart_increasing_with_yen|시장 호황 엔화 관련 상승하는 그래프 chart increasing with yen
📧|이메일|e_mail|이메일 편지 e-mail
📨|받은 편지|incoming_envelope|받은 이메일 편지 수신된 incoming envelope
📩|보낸 편지|envelope_with_arrow|보낸 이메일 편지 전송된 envelope with arrow
📤|보낸 편지함|outbox_tray|메일 전송 보낸 편지함 보낸편지함 이메일 편지 보내기 outbox tray
📥|받은 편지함|inbox_tray|메일 수신 받은 편지함 받은편지함 이메일 편지 받기 inbox tray
📫|표지가 올라간 닫힌 우편함|closed_mailbox_with_raised_flag|우편함 편지 표지가 올라간 닫힌 closed mailbox with raised flag
📪|표지가 내려간 닫힌 우편함|closed_mailbox_with_lowered_flag|우편함 편지 표지가 내려간 닫힌 closed mailbox with lowered flag
📬|표지가 올라간 열린 우편함|open_mailbox_with_raised_flag|우편함 편지 표지가 올라간 열린 open mailbox with raised flag
📭|표지가 내려간 열린 우편함|open_mailbox_with_lowered_flag|우편함 편지 표지가 내려간 열린 open mailbox with lowered flag
📮|우편함|postbox|우체국 우편함 편지 postbox
🗳️|투표 용지가 있는 투표 상자|ballot_box_with_ballot|투표 용지가 있는 상자 투표상자 ballot box with
✏️|연필|pencil|연필 필기도구 pencil
✒️|검은색 펜촉|black_nib|검은색 펜촉 펜 black nib
🖋️|만년필|fountain_pen|만년필 펜촉 필기도구 fountain pen
🖊️|펜|pen|볼펜 펜 pen
🖌️|붓|paintbrush|붓 페인트 브러쉬 페인트붓 paintbrush
🖍️|크레용|crayon|크레용 크레파스 crayon
💼|서류 가방|briefcase|가방 서류 briefcase
📁|폴더|file_folder|파일 폴더 file folder
📂|폴더 열기|open_file_folder|열기 열린 폴더 파일 open file folder
🗂️|카드 색인 파일|card_index_dividers|색인 카드 파일 폴더 card index dividers
📆|뜯어진 달력|tear_off_calendar|달력 뜯어진 일정 캘린더 tear-off calendar
🗒️|스프링 노트|spiral_notepad|노트 패드 스프링 spiral notepad
🗓️|스프링 달력|spiral_calendar|달력 벽걸이 스프링 spiral calendar
📇|카드 인덱스|card_index|명함 인덱스 카드 card index
📈|상승하는 그래프|chart_increasing|그래프 상승하는 상향 호황 chart increasing
📉|내려가는 그래프|chart_decreasing|그래프 내려가는 불황 하향 chart decreasing
📊|막대 그래프|bar_chart|그래프 막대 막대그래프 bar chart
📋|클립보드|clipboard|클리핑 클립 클립보드 clipboard
🖇️|이어져 있는 클립|linked_paperclips|이어져 있는 클립 linked paperclips
📏|자|straight_ruler|자 직각 straight ruler
📐|삼각자|triangular_ruler|삼각자 삼각형 자 triangular ruler
✂️|가위|scissors|가위 기구 도구 scissors
🗃️|카드 파일 상자|card_file_box|카드 상자 파일 card file box
🗄️|파일 보관 서랍장|file_cabinet|캐비닛 파일 보관 서랍장 file cabinet
🔓|열린 자물쇠|unlocked|락 열린 자물쇠 잠금풀림 unlocked
🔏|자물쇠와 펜|locked_with_pen|사생활 자물쇠 자물쇠와 펜 프라이버시 locked with pen
🔐|자물쇠와 열쇠|locked_with_key|보안 열쇠 자물쇠 자물쇠와 locked with key
🗝️|오래된 열쇠|old_key|보물 열쇠 오래된 old key
🔨|망치|hammer|도구 망치 해머 hammer
🪓|도끼|axe|나무 도끼 손도끼 쪼개기 axe
⛏️|곡괭이|pick|곡괭이 광산 pick
⚒️|망치와 곡괭이|hammer_and_pick|곡괭이 망치 망치와 hammer and pick
🛠️|망치와 렌치|hammer_and_wrench|렌치 망치 망치와 스패너 hammer and wrench
🗡️|단검|dagger|단검 단도 대거 dagger
⚔️|쌍검|crossed_swords|검 쌍검 crossed swords
💣|폭탄|bomb|폭발 폭탄 bomb
🪃|부메랑|boomerang|반동 부메랑 영향 호주 boomerang
🏹|활과 화살|bow_and_arrow|궁수 사수자리 화살 활 활과 bow and arrow
🛡️|방패|shield|방패 보호 shield
🪚|목공 톱|carpentry_saw|도구 목공 톱 목수 목재 carpentry saw
🪛|드라이버|screwdriver|나사 도구 드라이버 screwdriver
🔩|볼트와 너트|nut_and_bolt|나사 너트 도구 볼트 볼트와 nut and bolt
⚙️|톱니바퀴|gear|기어 톱니바퀴 gear
🗜️|압축기|clamp|압축기 콤프레셔 clamp
⚖️|접시저울|balance_scale|균형 저울 접시저울 정의 천칭자리 balance scale
🦯|시각장애인 지팡이|white_cane|시각장애 시각장애인 지팡이 접근성 white cane
🔗|링크|link|링크 표시 link
⛓️|쇠사슬|chains|사슬 쇠사슬 체인 chains
🪝|갈고리|hook|갈고리 걸리게 하다 고리 곡선 팔리는 hook
🧰|공구통|toolbox|공구 공구통 공구함 정비공 toolbox
🧲|자석|magnet|말굽 자석 편자 magnet
🪜|사다리|ladder|계단 단계 사다리 상승 ladder
⚗️|증류기|alembic|정류 정화 증류 증류기 alembic
🧪|시험관|test_tube|과학 시험관 실험 연구실 화학 test tube
🧫|페트리 접시|petri_dish|미생물 박테리아 생물학 실험실 페트리 접시 petri dish
🧬|DNA|dna|DNA 생물 생물학 유전 유전학 진화 dna
🔬|현미경|microscope|기구 도구 장치 현미경 microscope
🔭|망원경|telescope|도구 망원경 장비 telescope
📡|위성 안테나|satellite_antenna|안테나 위성 방송 satellite antenna
💉|주사기|syringe|병원 주사 바늘 주사기 치료 syringe
🩸|핏방울|drop_of_blood|생리 핏방울 헌혈 drop of blood
💊|알약|pill|알약 약 pill
🩹|반창고|adhesive_bandage|반창고 밴드 adhesive bandage
🩼|목발|crutch|다치다 막대 목발 이동 보조 장애 지팡이 crutch
🩺|청진기|stethoscope|심박수 의사 청진기 stethoscope
🩻|엑스레이|x_ray|뼈 엑스레이 의료 의사 해골 x-ray
🚪|문|door|도어 문 door
🛗|엘리베이터|elevator|승강 장치 승강기 엘리베이터 접근성 elevator
🪞|거울|mirror|거울 검경 반사 반사체 mirror
🪟|창문|window|맑은 공기 전망 창문 창틀 투명한 window
🛏️|침대|bed|침대 호텔 bed
🛋️|소파와 전등|couch_and_lamp|소파 소파와 전등 couch and lamp
🪑|의자|chair|앉기 의자 chair
🚽|변기|toilet|변기 toilet
🪠|뚫어뻥|plunger|뚫어뻥 배관공 변기 화장실 흡입 plunger
🚿|샤워|shower|물 샤워 shower
🛁|욕조|bathtub|목욕 샤워 욕조 bathtub
🪤|쥐덫|mouse_trap|덫 미끼 쥐덫 함정 mouse trap
🪒|면도칼|razor|날카로운 면도 면도칼 razor
🧴|로션|lotion_bottle|로션 모이스처라이저 샴푸 선크림 lotion bottle
🧷|옷핀|safety_pin|고정용 핀 옷핀 safety pin
🧹|빗자루|broom|마녀 비질 빗자루 broom
🧺|바구니|basket|바구니 빨래바구니 basket
🧻|두루마리|roll_of_paper|두루마리 종이 수건 화장지 휴지 roll of paper
🪣|양동이|bucket|들통 양동이 통 bucket
🧼|비누|soap|목욕 비누 거품 그릇 클렌징 soap
🫧|거품|bubbles|거품 물 속 비누 청소 트림 bubbles
🪥|칫솔|toothbrush|깨끗한 솔 욕실 위생 이 칫솔 toothbrush
🧽|스펀지|sponge|스펀지 청소 흡수 sponge
🧯|소화기|fire_extinguisher|소화 소화기 진화 fire extinguisher
🚬|흡연 구역 신호|cigarette|담배 흡연 구역 신호 cigarette
⚰️|관|coffin|관 장례식 죽음 coffin
🪦|묘비|headstone|묘비 묘석 묘지 무덤 headstone
⚱️|납골 단지|funeral_urn|납골 단지 죽음 funeral urn
🧿|악마의 눈|nazar_amulet|구슬 나자르 부적 악마의 눈 탈리스만 nazar amulet
🪬|함사|hamsa|마리아 미리암 보호 부적 손 파티마 함사 hamsa
🗿|모아이|moai|모아이 모아이상 석상 moai
🪧|플래카드|placard|데모 시위 표지판 플래카드 피켓 placard
🪪|신분증|identification_card|ID 보안 신분증 자격증 허가증 identification card`),
  },
  {
    id: "symbol",
    label: "기호",
    icon: "❤️",
    items: parse(`
❤️|빨간 하트|heart|하트 사랑 좋아 빨간색 마음 red heart
🧡|주황 하트|orange_heart|하트 주황색 orange heart
💛|노란 하트|yellow_heart|하트 노란색 노란 사랑 yellow heart
💚|초록 하트|green_heart|하트 초록색 녹색 사랑 green heart
💙|파란 하트|blue_heart|하트 파란색 사랑 파란 blue heart
💜|보라 하트|purple_heart|하트 보라색 사랑 purple heart
🖤|검은 하트|black_heart|하트 검은색 검정 블랙 악 black heart
💔|깨진 하트|broken_heart|이별 슬픔 하트 깨진 결별 이별의 고통 아픔 헤어짐 broken heart
✅|확인|white_check_mark|완료 확인 체크 할일 표시 check mark button
☑️|체크 상자|ballot_box_with_check|체크 확인 체크박스 체크상자 체크표시된 투표란 투표 check box with
✔️|체크 표시|heavy_check_mark|체크 확인 진한 표시 체크표시 check mark
❌|엑스|x|취소 틀림 아니오 엑스 표시 엑스표 cross mark
⭕|동그라미|o|맞음 정답 크고 진한 동그라미 원 hollow red circle
❗|느낌표|exclamation|중요 주의 빨간색 느낌표 부호 red exclamation mark
❓|물음표|question|질문 궁금 빨간색 물음표 물음 의문 red question mark
⚠️|경고|warning|경고 주의 warning
🚫|금지|no_entry_sign|금지 안됨 들어오지 마시오 진입 표시 prohibited
💯|백점|100|최고 완벽 백점 표시 hundred points
🆕|새것|new|새 신규 뉴 NEW 신호 새로운 소식 새롭다 button
🔴|빨간 원|red_circle|빨강 상태 빨간 원 큰 red circle
🟡|노란 원|yellow_circle|노랑 상태 노란색 원 yellow circle
🟢|초록 원|green_circle|초록 상태 녹색 원 green circle
🔵|파란 원|large_blue_circle|파랑 상태 파란 원 큰 blue circle
➡️|오른쪽 화살표|arrow_right|화살표 다음 우향 동쪽 right arrow
⬅️|왼쪽 화살표|arrow_left|화살표 이전 좌향 서쪽 left arrow
⬆️|위 화살표|arrow_up|화살표 위 상향 북쪽 위쪽 up arrow
⬇️|아래 화살표|arrow_down|화살표 아래 하향 남쪽 down arrow
🔁|반복|repeat|반복 다시 전곡 재생 꼬리를 무는 화살표 repeat button
✨|반짝임|sparkles|반짝 새로움 마법 블링블링 반짝거림 반짝반짝 sparkles
💌|러브레터|love_letter|러브레터 사랑 고백 연애 편지 love letter
💘|화살이 꽂힌 하트|heart_with_arrow|사랑 큐피드 화살이 꽂힌 하트 heart with arrow
💝|리본 달린 하트|heart_with_ribbon|리본 달린 하트 발렌타인 초콜렛 상자 사랑 선물 heart with ribbon
💖|빛나는 하트|sparkling_heart|기쁨으로 가득찬 마음 두근거림 빛나는 하트 사랑 사랑의 기쁨 설렘 sparkling heart
💗|커지는 하트|growing_heart|깊어지는 마음 사랑 커지는 하트 growing heart
💓|두근거리는 하트|beating_heart|두근거리는 마음 하트 두근두근 떨리는 사랑 beating heart
💞|회전하는 하트|revolving_hearts|귀여움 빙글빙글 하트 사랑 사랑스러움 회전하는 revolving hearts
💕|하트 두 개|two_hearts|사랑 연인 하트 두 개 two hearts
💟|하트 장식|heart_decoration|하트 장식 heart decoration
❣️|하트 모양 느낌표|heart_exclamation|느낌표 하트 모양 heart exclamation
❤️‍🔥|불 난 하트|heart_on_fire|마음 불 난 하트 불타는 사랑 heart on fire
❤️‍🩹|낫고 있는 하트|mending_heart|개선 건강 낫고 있는 하트 치유 회복 힐링 mending heart
🤎|갈색 하트|brown_heart|갈색 하트 brown heart
🤍|흰색 하트|white_heart|하트 흰색 white heart
💋|입술|kiss_mark|뽀뽀 입술 쪼옥 쪽 키스 kiss mark
💢|화남|anger_symbol|울컥 화 화남 anger symbol
💥|충돌|collision|꽝 충돌 쾅 collision
💫|어지러움|dizzy|띠용 별 어지러움 어질어질 dizzy
💦|땀|sweat_droplets|곤란 당황 땀 삐질삐질 sweat droplets
💨|달려나감|dashing_away|달려나감 슝 후다닥 dashing away
🕳️|구멍|hole|검은 구멍 hole
💬|말풍선|speech_balloon|대화 대화창 말풍선 speech balloon
👁️‍🗨️|말풍선 속 눈|eye_in_speech_bubble|눈 말풍선 속 eye in speech bubble
🗨️|왼쪽 말풍선|left_speech_bubble|말 말풍선 왼쪽 left speech bubble
🗯️|화난 표현의 오른쪽 말풍선|right_anger_bubble|말풍선 화난 표현의 오른쪽 right anger bubble
💭|생각 풍선|thought_balloon|생각 풍선 thought balloon
💤|졸림|zzz|수면 자고 있음 졸림 쿨쿨 ZZZ
🏧|에이티엠|atm_sign|ATM 에이티엠 현금인출기 sign
🚮|쓰레기는 쓰레기통에|litter_in_bin_sign|쓰레기 쓰레기는 쓰레기통에 쓰레기통 litter in bin sign
🚰|음수대|potable_water|식수대 음수대 potable water
♿|휠체어|wheelchair_symbol|장애인 휠체어 wheelchair symbol
🚹|남자 화장실|men_s_room|남성 남성용 남자 화장실 남자용 men’s room
🚺|여자 화장실|women_s_room|여성 여성용 여자 화장실 여자용 women’s room
🚻|화장실|restroom|공중화장실 화장실 restroom
🚼|수유실|baby_symbol|기저귀 수유실 baby symbol
🚾|더블유씨|water_closet|공중화장실 더블유씨 화장실 water closet
🛂|출입국 심사|passport_control|여권 출입국 심사 passport control
🛃|세관|customs|세관 customs
🛄|짐 찾는 곳|baggage_claim|짐 찾는 곳 화물 baggage claim
🛅|화물 서비스|left_luggage|짐 화물 서비스 left luggage
🚸|어린이 보호 구역|children_crossing|어린이 구역 보호 children crossing
⛔|진입 금지|no_entry|들어오지 마시오 진입 금지 표시 no entry
🚳|자전거 금지|no_bicycles|자전거 금지 주행 no bicycles
🚭|금연 신호|no_smoking|금연 구역 신호 no smoking
🚯|쓰레기 투기 금지|no_littering|금지 쓰레기 투기 no littering
🚱|마실 수 없는 물|non_potable_water|마시지 마시오 마실 수 없는 물 섭취 금지 non-potable water
🚷|보행자 금지|no_pedestrians|보행자 금지 통행 no pedestrians
📵|휴대전화 사용금지|no_mobile_phones|전화 사용금지 휴대전화 끄기 no mobile phones
🔞|성인용|no_one_under_eighteen|18금 18세 이하 금지 성인용 no one under eighteen
☢️|방사능|radioactive|방사능 방사선 위험 주의 radioactive
☣️|생물학적 위험|biohazard|바이오해저드 생물학적 위험 biohazard
↗️|우상향 화살표|up_right_arrow|북동쪽 우상향 화살표 up-right arrow
↘️|우하향 화살표|down_right_arrow|남동쪽 우하향 화살표 down-right arrow
↙️|좌하향 화살표|down_left_arrow|남서쪽 좌하향 화살표 down-left arrow
↖️|좌상향 화살표|up_left_arrow|북서쪽 좌상향 화살표 up-left arrow
↕️|상하향 화살표|up_down_arrow|상하향 화살표 위아래 up-down arrow
↔️|좌우향 화살표|left_right_arrow|좌우 좌우향 화살표 left-right arrow
↩️|왼쪽으로 꺾어지는 우향 화살표|right_arrow_curving_left|왼쪽으로 꺾어지는 우향 화살표 좌회전 right arrow curving left
↪️|오른쪽으로 꺾어지는 좌향 화살표|left_arrow_curving_right|오른쪽으로 꺾어지는 좌향 화살표 우회전 left arrow curving right
⤴️|위쪽으로 꺾어지는 우향 화살표|right_arrow_curving_up|위쪽으로 꺾어지는 우향 화살표 좌회전 right arrow curving up
⤵️|아래쪽으로 꺾어지는 우향 화살표|right_arrow_curving_down|아래쪽으로 꺾어지는 우향 화살표 우회전 right arrow curving down
🔃|시계 방향 화살표|clockwise_vertical_arrows|새로고침 표시 시계 방향 화살표 clockwise vertical arrows
🔄|반시계 방향 화살표|counterclockwise_arrows_button|반시계 방향 화살표 counterclockwise arrows button
🔙|뒤로|back_arrow|뒤로 왼쪽 화살표 BACK arrow
🔚|종료|end_arrow|끝내기 화살표 종료 END arrow
🔛|켜짐|on_arrow|양쪽 방향 화살표 켜짐 ON! arrow
🔜|곧|soon_arrow|곧 진행된다는 신호 표시 화살표 SOON arrow
🔝|위로 화살표|top_arrow|상단 위로 화살표 위쪽 위쪽으로 TOP arrow
🛐|예배공간|place_of_worship|기도 사원 예배 예배공간 place of worship
⚛️|원자 기호|atom_symbol|원자 기호 atom symbol
🕉️|옴|om|옴 힌두교 om
✡️|다비드별|star_of_david|다비드 다비드별 별 유대교 star of David
☸️|진리의 수레바퀴|wheel_of_dharma|다르마 바퀴 불교 수레바퀴 진리의 wheel of dharma
☯️|음양|yin_yang|양 음 음양 yin yang
✝️|라틴 십자가|latin_cross|기독교 라틴 십자가 종교 latin cross
☦️|전통적인 십자가|orthodox_cross|기독교 십자가 전통적인 종교 orthodox cross
☪️|초승달과 별|star_and_crescent|별 이슬람 종교 초승달 초승달과 star and crescent
☮️|평화 기호|peace_symbol|평화 기호 peace symbol
🕎|메노라|menorah|메노라 유대교 촛대 menorah
🔯|육각 별|dotted_six_pointed_star|별 육각 육각형 dotted six-pointed star
♈|양자리|aries|별 별자리 양 양자리 Aries
♉|황소자리|taurus|별 별자리 황소 황소자리 Taurus
♊|쌍둥이 자리|gemini|별 별자리 쌍둥이 자리 Gemini
♋|게자리|cancer|게자리 별자리 Cancer
♌|사자자리|leo|별 별자리 사자 사자자리 Leo
♍|처녀자리|virgo|별 별자리 처녀 처녀자리 Virgo
♎|천칭자리|libra|별 별자리 천칭 천칭자리 Libra
♏|전갈자리|scorpio|별 별자리 스콜피온 전갈 전갈자리 Scorpio
♐|사수자리|sagittarius|별 별자리 사수자리 활 Sagittarius
♑|염소자리|capricorn|별 별자리 염소 염소자리 Capricorn
♒|물병자리|aquarius|물 물병 물병자리 별 별자리 Aquarius
♓|물고기자리|pisces|물고기 물고기자리 별 별자리 Pisces
⛎|뱀주인자리|ophiuchus|뱀주인자리 별자리 Ophiuchus
🔀|랜덤 재생|shuffle_tracks_button|랜덤 재생 엇갈린 화살표 shuffle tracks button
🔂|한 곡 반복 재생|repeat_single_button|꼬리를 무는 화살표와 숫자 1 한 곡 반복 재생 화살표 repeat single button
▶️|재생 버튼|play_button|삼각형 재생 버튼 플레이 play button
⏩|빨리 감기|fast_forward_button|빨리 감기 오른쪽 화살표 두 개 fast-forward button
⏭️|다음 트랙 버튼|next_track_button|다음 장면 트랙 버튼 next track button
⏯️|재생 또는 일시 정지 버튼|play_or_pause_button|일시 정지 재생 또는 버튼 play or pause button
◀️|반대로 버튼|reverse_button|반대 반대로 버튼 복귀 reverse button
⏪|되감기|fast_reverse_button|되감기 왼쪽 화살표 두 개 fast reverse button
⏮️|마지막 트랙 버튼|last_track_button|마지막 노래 트랙 버튼 최종 last track button
🔼|위쪽 삼각형|upwards_button|삼각형 위쪽 버튼 upwards button
⏫|위쪽 화살표|fast_up_button|위로 위쪽 화살표 fast up button
🔽|아래쪽 삼각형|downwards_button|삼각형 아래쪽 버튼 downwards button
⏬|아래쪽 화살표|fast_down_button|아래로 아래쪽 화살표 아랫쪽 fast down button
⏸️|일시 정지 버튼|pause_button|일시 정지 버튼 pause button
⏹️|정지 버튼|stop_button|사각형 정지 버튼 중단 중지 stop button
⏺️|녹음 버튼|record_button|기록 녹음 버튼 동그라미 원 record button
⏏️|꺼냄 버튼|eject_button|꺼내기 꺼냄 버튼 추출 eject button
🎦|영화|cinema|극장 영화 영화관 cinema
🔅|밝기 낮음|dim_button|낮은 밝기 낮음 어두움 표시 dim button
🔆|밝기 높음|bright_button|높은 밝기 높음 밝음 표시 bright button
📶|안테나 신호|antenna_bars|신호 강도 안테나 휴대전화 antenna bars
📳|진동 모드|vibration_mode|진동 모드 휴대전화 진동모드 vibration mode
📴|휴대전화 끄기|mobile_phone_off|전원이 꺼진 휴대전화 끄기 전원 mobile phone off
♀️|여성 기호|female_sign|기호 여성 female sign
♂️|남성 기호|male_sign|기호 남성 male sign
⚧️|트랜스젠더 기호|transgender_symbol|트랜스젠더 기호 transgender symbol
✖️|곱하기|multiply|곱셈 곱셈기호 곱하기 엑스 취소 multiply
➕|더하기|plus|더하기 표시 플러스 plus
➖|빼기|minus|마이너스 빼기 표시 minus
➗|나누기|divide|나누기 표시 divide
🟰|등호 기호|heavy_equals_sign|같음 등호 기호 heavy equals sign
♾️|무한|infinity|뫼비우스 무한 영원 infinity
‼️|두 개의 느낌표|double_exclamation_mark|느낌표 두 개의 double exclamation mark
⁉️|느낌표와 물음표|exclamation_question_mark|느낌표 느낌표와 물음표 부호 exclamation question mark
❔|하얀색 물음표|white_question_mark|물음 의문 질문 하얀색 물음표 white question mark
❕|하얀색 느낌표|white_exclamation_mark|느낌 하얀색 느낌표 white exclamation mark
〰️|물결 모양 대시|wavy_dash|물결 모양 대시 물결표 wavy dash
💱|환전|currency_exchange|교환 돈 화폐 환전 currency exchange
💲|미국 달러|heavy_dollar_sign|달러화 돈 미국 달러 화폐 불 heavy dollar sign
⚕️|의학 기호|medical_symbol|의술의 신 의학 기호 medical symbol
♻️|재활용 표시|recycling_symbol|재활용 표시 recycling symbol
⚜️|백합 문장|fleur_de_lis|문장 백합 fleur-de-lis
🔱|삼지창|trident_emblem|삼지창 창 trident emblem
📛|이름표|name_badge|명찰 이름표 name badge
🔰|노란색 초록색 이파리 모양|japanese_symbol_for_beginner|노란색 초록색 이파리 모양 초보자 Japanese symbol for beginner
❎|초록 상자 안 엑스표|cross_mark_button|상자 안 엑스표 초록 cross mark button
➰|고리|curly_loop|고리 루프 curly loop
➿|두 개의 고리|double_curly_loop|두 개의 고리 루프 double curly loop
〽️|부분 교체 기호|part_alternation_mark|기호 부분 교체 part alternation mark
✳️|여덟 갈래 별표|eight_spoked_asterisk|별표 여덟 갈래 eight-spoked asterisk
✴️|팔각 별|eight_pointed_star|별 팔각 eight-pointed star
❇️|반짝임|sparkle|반짝 반짝임 sparkle
©️|저작권|copyright|동그라미 C 씨 저작권 copyright
®️|등록상표|registered|동그라미 R 등록상표 알 registered
™️|상표|trade_mark|상표 표시 트레이드 마크 trade mark
#️⃣|키 캡: #|keycap|키 캡 캡: # keycap:
*️⃣|키 캡: *|keycap|키 캡 캡: * keycap:
0️⃣|키 캡: 0|keycap_0|키 캡 캡: 0 keycap:
1️⃣|키 캡: 1|keycap_1|키 캡 캡: 1 keycap:
2️⃣|키 캡: 2|keycap_2|키 캡 캡: 2 keycap:
3️⃣|키 캡: 3|keycap_3|키 캡 캡: 3 keycap:
4️⃣|키 캡: 4|keycap_4|키 캡 캡: 4 keycap:
5️⃣|키 캡: 5|keycap_5|키 캡 캡: 5 keycap:
6️⃣|키 캡: 6|keycap_6|키 캡 캡: 6 keycap:
7️⃣|키 캡: 7|keycap_7|키 캡 캡: 7 keycap:
8️⃣|키 캡: 8|keycap_8|키 캡 캡: 8 keycap:
9️⃣|키 캡: 9|keycap_9|키 캡 캡: 9 keycap:
🔟|키 캡: 10|keycap_10|키 캡 캡: 10 keycap:
🔠|대문자|input_latin_uppercase|대문자 입력 영어 input latin uppercase
🔡|소문자|input_latin_lowercase|소문자 입력 영어 input latin lowercase
🔢|숫자|input_numbers|숫자 입력 input numbers
🔣|기호|input_symbols|기호 입력 input symbols
🔤|라틴어 알파벳|input_latin_letters|라틴어 알파벳 입력 input latin letters
🅰️|에이형|a_button_blood_type|A 에이형 혈액형 button (blood type)
🆎|에이비형|ab_button_blood_type|AB 에이비형 혈액형 button (blood type)
🅱️|비형|b_button_blood_type|B 비형 혈액형 button (blood type)
🆑|씨엘|cl_button|CL 네모 안에 씨엘 안 button
🆒|쿨|cool_button|cool 쿨 신호 COOL button
🆓|프리|free_button|자유 신호 프리 FREE button
ℹ️|정보 출처|information|I 정보 출처 information
🆔|아이디|id_button|ID 아이디 신호 표시 button
Ⓜ️|원글자 엠|circled_m|M 동그라미 원 원글자 엠 circled
🆖|엔지|ng_button|NG 노굿 신호 엔지 표시 button
🅾️|오형|o_button_blood_type|O 오형 혈액형 button (blood type)
🆗|오케이|ok_button|OK 네 예 오케이 신호 좋다 button
🅿️|주차 표시|p_button|P 음각 피 주차 표시 주차장 파킹 button
🆘|에스오에스|sos_button|SOS 구조 신호 에스오에스 button
🆙|위로 버튼|up_button|UP 업 위로 버튼 위쪽으로 UP! button
🆚|대|vs_button|VS 대 브이에스 button
🈁|일본어 "여기" 버튼|japanese_here_button|koko 일본어 "여기" 버튼 카타카나 Japanese “here” button
🈂️|일본어 "봉사료" 버튼|japanese_service_charge_button|sa 일본어 "봉사료" 버튼 카타카나 Japanese “service charge” button
🈷️|달 월|japanese_monthly_amount_button|개월 달 월 한달 Japanese “monthly amount” button
🈶|있을 유|japanese_not_free_of_charge_button|있을 유 있음 Japanese “not free of charge” button
🈯|가리킬 지|japanese_reserved_button|가리키다 가리킬 지 손가락 지칭 Japanese “reserved” button
🉐|얻을 득|japanese_bargain_button|얻을 득 이득 이익 획득 Japanese “bargain” button
🈹|나눌 할|japanese_discount_button|나누기 나눌 할 나눔 분리 Japanese “discount” button
🈚|없을 무|japanese_free_of_charge_button|없을 무 없음 Japanese “free of charge” button
🈲|금할 금|japanese_prohibited_button|금지 금하다 금할 금 차단 Japanese “prohibited” button
🉑|옳을 가|japanese_acceptable_button|맞음 옮음 옳을 가 허가 Japanese “acceptable” button
🈸|거듭 신|japanese_application_button|거듭 신 Japanese “application” button
🈴|합할 합|japanese_passing_grade_button|전체 합하기 합할 합 Japanese “passing grade” button
🈳|빌 공|japanese_vacancy_button|비어있음 빌 공 텅 빈 상태 Japanese “vacancy” button
㊗️|원 안의 축하 표의문자|japanese_congratulations_button|원 안의 축하 표의문자 표시된 중국어 Japanese “congratulations” button
㊙️|원 표시된 비밀 표의문자|japanese_secret_button|비밀 원 표시된 표의문자 중국어 Japanese “secret” button
🈺|벼슬 관|japanese_open_for_business_button|벼슬 관 Japanese “open for business” button
🈵|찰 만|japanese_no_vacancy_button|가득 찰 만 Japanese “no vacancy” button
🟠|오렌지색 원|orange_circle|오렌지색 원 orange circle
🟣|보라색 원|purple_circle|보라색 원 purple circle
🟤|갈색 원|brown_circle|갈색 원 brown circle
⚫|검은색 원|black_circle|검은색 원 동그라미 black circle
⚪|흰색 원|white_circle|동그라미 원 흰색 white circle
🟥|빨간색 사각형|red_square|빨간색 사각형 red square
🟧|오렌지색 사각형|orange_square|사각형 오렌지색 orange square
🟨|노란색 사각형|yellow_square|노란색 사각형 yellow square
🟩|녹색 사각형|green_square|녹색 사각형 green square
🟦|파란색 사각형|blue_square|사각형 파란색 blue square
🟪|보라색 사각형|purple_square|보라색 사각형 purple square
🟫|갈색 사각형|brown_square|갈색 사각형 brown square
⬛|큰 검은색 사각형|black_large_square|무늬 사각형 큰 검은색 black large square
⬜|큰 흰색 사각형|white_large_square|무늬 사각형 큰 흰색 white large square
◼️|중간 검은색 사각형|black_medium_square|무늬 사각형 중간 검은색 black medium square
◻️|중간 흰색 사각형|white_medium_square|무늬 사각형 중간 흰색 white medium square
◾|중각 작은 검은색 사각형|black_medium_small_square|무늬 사각형 중각 작은 검은색 black medium-small square
◽|중간 작은 흰색 사각형|white_medium_small_square|무늬 사각형 중간 작은 흰색 white medium-small square
▪️|작은 검은색 사각형|black_small_square|무늬 사각형 작은 검은색 black small square
▫️|작은 흰색 사각형|white_small_square|무늬 사각형 작은 흰색 white small square
🔶|큰 주황색 마름모|large_orange_diamond|마름모 오렌지색 주황색 큰 large orange diamond
🔷|큰 파란색 마름모|large_blue_diamond|마름모 큰 파란색 파랑 large blue diamond
🔸|작은 주황색 마름모|small_orange_diamond|마름모 오렌지색 작은 주황색 small orange diamond
🔹|작은 파란색 마름모|small_blue_diamond|마름모 작은 파란색 파랑 small blue diamond
🔺|빨간색 위쪽 삼각형|red_triangle_pointed_up|빨간색 위쪽 삼각형 빨강 red triangle pointed up
🔻|빨간색 아래쪽 삼각형|red_triangle_pointed_down|빨간색 아래쪽 삼각형 빨강 red triangle pointed down
💠|점이 찍힌 다이아몬드 모양|diamond_with_a_dot|다이아몬드 모양 마름모꼴 점이 찍힌 diamond with a dot
🔘|라디오 버튼|radio_button|라디오 버튼 radio button
🔳|테두리가 하얀 사각 버튼|white_square_button|버튼 사각형 테두리가 하얀 사각 white square button
🔲|테두리가 검은 사각 버튼|black_square_button|버튼 사각형 테두리가 검은 사각 black square button
🏁|격자 무늬 깃발|chequered_flag|격자 무늬 깃발 결승선 레이싱 스포츠 chequered flag
🚩|세모 깃발|triangular_flag|깃발 세모 위치 표시 triangular flag
🎌|엇갈린 일본 국기|crossed_flags|국가 행사 국기 엇갈린 일본 crossed flags
🏴|펄럭이는 검은색 깃발|black_flag|깃발 펄럭이는 검은색 플래그 black flag
🏳️|펄럭이는 흰색 깃발|white_flag|깃발 펄럭이는 흰색 플래그 항복 white flag
🏳️‍🌈|무지개 깃발|rainbow_flag|깃발 무지개 rainbow flag
🏳️‍⚧️|트랜스젠더 깃발|transgender_flag|깃발 분홍색 트랜스젠더 하늘색 하얀색 transgender flag
🏴‍☠️|해적 깃발|pirate_flag|보물섬 약탈자 해골 깃발 해적 pirate flag`),
  },
  {
    id: "flag",
    label: "국기",
    icon: "🏳️",
    items: parse(`
🇦🇨|어센션섬|flag_ascension_island|국기 깃발 국가 나라 지역 깃발   깃발: 어센션섬 flag: Ascension Island ac
🇦🇩|안도라|flag_andorra|국기 깃발 국가 나라 지역 깃발   깃발: 안도라 flag: Andorra ad
🇦🇪|아랍에미리트|flag_united_arab_emirates|국기 깃발 국가 나라 지역 깃발   깃발: 아랍에미리트 flag: United Arab Emirates ae
🇦🇫|아프가니스탄|flag_afghanistan|국기 깃발 국가 나라 지역 깃발   깃발: 아프가니스탄 flag: Afghanistan af
🇦🇬|앤티가 바부다|flag_antigua_barbuda|국기 깃발 국가 나라 지역 깃발   깃발: 앤티가 바부다 flag: Antigua & Barbuda ag
🇦🇮|앵귈라|flag_anguilla|국기 깃발 국가 나라 지역 깃발   깃발: 앵귈라 flag: Anguilla ai
🇦🇱|알바니아|flag_albania|국기 깃발 국가 나라 지역 깃발   깃발: 알바니아 flag: Albania al
🇦🇲|아르메니아|flag_armenia|국기 깃발 국가 나라 지역 깃발   깃발: 아르메니아 flag: Armenia am
🇦🇴|앙골라|flag_angola|국기 깃발 국가 나라 지역 깃발   깃발: 앙골라 flag: Angola ao
🇦🇶|남극 대륙|flag_antarctica|국기 깃발 국가 나라 지역 깃발   깃발: 남극 대륙 flag: Antarctica aq
🇦🇷|아르헨티나|flag_argentina|국기 깃발 국가 나라 지역 깃발   깃발: 아르헨티나 flag: Argentina ar
🇦🇸|아메리칸 사모아|flag_american_samoa|국기 깃발 국가 나라 지역 깃발   깃발: 아메리칸 사모아 flag: American Samoa as
🇦🇹|오스트리아|flag_austria|국기 깃발 국가 나라 지역 깃발   깃발: 오스트리아 flag: Austria at
🇦🇺|오스트레일리아|flag_australia|국기 깃발 국가 나라 지역 깃발   깃발: 오스트레일리아 flag: Australia au
🇦🇼|아루바|flag_aruba|국기 깃발 국가 나라 지역 깃발   깃발: 아루바 flag: Aruba aw
🇦🇽|올란드 제도|flag_land_islands|국기 깃발 국가 나라 지역 깃발   깃발: 올란드 제도 flag: Åland Islands ax
🇦🇿|아제르바이잔|flag_azerbaijan|국기 깃발 국가 나라 지역 깃발   깃발: 아제르바이잔 flag: Azerbaijan az
🇧🇦|보스니아 헤르체고비나|flag_bosnia_herzegovina|국기 깃발 국가 나라 지역 깃발   깃발: 보스니아 헤르체고비나 flag: Bosnia & Herzegovina ba
🇧🇧|바베이도스|flag_barbados|국기 깃발 국가 나라 지역 깃발   깃발: 바베이도스 flag: Barbados bb
🇧🇩|방글라데시|flag_bangladesh|국기 깃발 국가 나라 지역 깃발   깃발: 방글라데시 flag: Bangladesh bd
🇧🇪|벨기에|flag_belgium|국기 깃발 국가 나라 지역 깃발   깃발: 벨기에 flag: Belgium be
🇧🇫|부르키나파소|flag_burkina_faso|국기 깃발 국가 나라 지역 깃발   깃발: 부르키나파소 flag: Burkina Faso bf
🇧🇬|불가리아|flag_bulgaria|국기 깃발 국가 나라 지역 깃발   깃발: 불가리아 flag: Bulgaria bg
🇧🇭|바레인|flag_bahrain|국기 깃발 국가 나라 지역 깃발   깃발: 바레인 flag: Bahrain bh
🇧🇮|부룬디|flag_burundi|국기 깃발 국가 나라 지역 깃발   깃발: 부룬디 flag: Burundi bi
🇧🇯|베냉|flag_benin|국기 깃발 국가 나라 지역 깃발   깃발: 베냉 flag: Benin bj
🇧🇱|생바르텔레미|flag_st_barth_lemy|국기 깃발 국가 나라 지역 깃발   깃발: 생바르텔레미 flag: St. Barthélemy bl
🇧🇲|버뮤다|flag_bermuda|국기 깃발 국가 나라 지역 깃발   깃발: 버뮤다 flag: Bermuda bm
🇧🇳|브루나이|flag_brunei|국기 깃발 국가 나라 지역 깃발   깃발: 브루나이 flag: Brunei bn
🇧🇴|볼리비아|flag_bolivia|국기 깃발 국가 나라 지역 깃발   깃발: 볼리비아 flag: Bolivia bo
🇧🇶|네덜란드령 카리브|flag_caribbean_netherlands|국기 깃발 국가 나라 지역 깃발   깃발: 네덜란드령 카리브 flag: Caribbean Netherlands bq
🇧🇷|브라질|flag_brazil|국기 깃발 국가 나라 지역 깃발   깃발: 브라질 flag: Brazil br
🇧🇸|바하마|flag_bahamas|국기 깃발 국가 나라 지역 깃발   깃발: 바하마 flag: Bahamas bs
🇧🇹|부탄|flag_bhutan|국기 깃발 국가 나라 지역 깃발   깃발: 부탄 flag: Bhutan bt
🇧🇻|부베섬|flag_bouvet_island|국기 깃발 국가 나라 지역 깃발   깃발: 부베섬 flag: Bouvet Island bv
🇧🇼|보츠와나|flag_botswana|국기 깃발 국가 나라 지역 깃발   깃발: 보츠와나 flag: Botswana bw
🇧🇾|벨라루스|flag_belarus|국기 깃발 국가 나라 지역 깃발   깃발: 벨라루스 flag: Belarus by
🇧🇿|벨리즈|flag_belize|국기 깃발 국가 나라 지역 깃발   깃발: 벨리즈 flag: Belize bz
🇨🇦|캐나다|flag_canada|국기 깃발 국가 나라 지역 깃발   깃발: 캐나다 flag: Canada ca
🇨🇨|코코스 제도|flag_cocos_keeling_islands|국기 깃발 국가 나라 지역 깃발   깃발: 코코스 제도 flag: Cocos (Keeling) Islands cc
🇨🇩|콩고-킨샤사|flag_congo_kinshasa|국기 깃발 국가 나라 지역 깃발   깃발: 콩고-킨샤사 flag: Congo - Kinshasa cd
🇨🇫|중앙 아프리카 공화국|flag_central_african_republic|국기 깃발 국가 나라 지역 깃발   깃발: 중앙 아프리카 공화국 flag: Central African Republic cf
🇨🇬|콩고-브라자빌|flag_congo_brazzaville|국기 깃발 국가 나라 지역 깃발   깃발: 콩고-브라자빌 flag: Congo - Brazzaville cg
🇨🇭|스위스|flag_switzerland|국기 깃발 국가 나라 지역 깃발   깃발: 스위스 flag: Switzerland ch
🇨🇮|코트디부아르|flag_c_te_d_ivoire|국기 깃발 국가 나라 지역 깃발   깃발: 코트디부아르 flag: Côte d’Ivoire ci
🇨🇰|쿡 제도|flag_cook_islands|국기 깃발 국가 나라 지역 깃발   깃발: 쿡 제도 flag: Cook Islands ck
🇨🇱|칠레|flag_chile|국기 깃발 국가 나라 지역 깃발   깃발: 칠레 flag: Chile cl
🇨🇲|카메룬|flag_cameroon|국기 깃발 국가 나라 지역 깃발   깃발: 카메룬 flag: Cameroon cm
🇨🇳|중국|flag_china|국기 깃발 국가 나라 지역 깃발   깃발: 중국 flag: China 중국 오성홍기 china cn cn
🇨🇴|콜롬비아|flag_colombia|국기 깃발 국가 나라 지역 깃발   깃발: 콜롬비아 flag: Colombia co
🇨🇵|클리퍼턴섬|flag_clipperton_island|국기 깃발 국가 나라 지역 깃발   깃발: 클리퍼턴섬 flag: Clipperton Island cp
🇨🇷|코스타리카|flag_costa_rica|국기 깃발 국가 나라 지역 깃발   깃발: 코스타리카 flag: Costa Rica cr
🇨🇺|쿠바|flag_cuba|국기 깃발 국가 나라 지역 깃발   깃발: 쿠바 flag: Cuba cu
🇨🇻|카보베르데|flag_cape_verde|국기 깃발 국가 나라 지역 깃발   깃발: 카보베르데 flag: Cape Verde cv
🇨🇼|퀴라소|flag_cura_ao|국기 깃발 국가 나라 지역 깃발   깃발: 퀴라소 flag: Curaçao cw
🇨🇽|크리스마스섬|flag_christmas_island|국기 깃발 국가 나라 지역 깃발   깃발: 크리스마스섬 flag: Christmas Island cx
🇨🇾|키프로스|flag_cyprus|국기 깃발 국가 나라 지역 깃발   깃발: 키프로스 flag: Cyprus cy
🇨🇿|체코|flag_czechia|국기 깃발 국가 나라 지역 깃발   깃발: 체코 flag: Czechia cz
🇩🇪|독일|flag_germany|국기 깃발 국가 나라 지역 깃발   깃발: 독일 flag: Germany de
🇩🇬|디에고 가르시아|flag_diego_garcia|국기 깃발 국가 나라 지역 깃발   깃발: 디에고 가르시아 flag: Diego Garcia dg
🇩🇯|지부티|flag_djibouti|국기 깃발 국가 나라 지역 깃발   깃발: 지부티 flag: Djibouti dj
🇩🇰|덴마크|flag_denmark|국기 깃발 국가 나라 지역 깃발   깃발: 덴마크 flag: Denmark dk
🇩🇲|도미니카|flag_dominica|국기 깃발 국가 나라 지역 깃발   깃발: 도미니카 flag: Dominica dm
🇩🇴|도미니카 공화국|flag_dominican_republic|국기 깃발 국가 나라 지역 깃발   깃발: 도미니카 공화국 flag: Dominican Republic do
🇩🇿|알제리|flag_algeria|국기 깃발 국가 나라 지역 깃발   깃발: 알제리 flag: Algeria dz
🇪🇦|세우타 및 멜리야|flag_ceuta_melilla|국기 깃발 국가 나라 지역 깃발   깃발: 세우타 및 멜리야 flag: Ceuta & Melilla ea
🇪🇨|에콰도르|flag_ecuador|국기 깃발 국가 나라 지역 깃발   깃발: 에콰도르 flag: Ecuador ec
🇪🇪|에스토니아|flag_estonia|국기 깃발 국가 나라 지역 깃발   깃발: 에스토니아 flag: Estonia ee
🇪🇬|이집트|flag_egypt|국기 깃발 국가 나라 지역 깃발   깃발: 이집트 flag: Egypt eg
🇪🇭|서사하라|flag_western_sahara|국기 깃발 국가 나라 지역 깃발   깃발: 서사하라 flag: Western Sahara eh
🇪🇷|에리트리아|flag_eritrea|국기 깃발 국가 나라 지역 깃발   깃발: 에리트리아 flag: Eritrea er
🇪🇸|스페인|flag_spain|국기 깃발 국가 나라 지역 깃발   깃발: 스페인 flag: Spain es
🇪🇹|에티오피아|flag_ethiopia|국기 깃발 국가 나라 지역 깃발   깃발: 에티오피아 flag: Ethiopia et
🇪🇺|유럽 연합|flag_european_union|국기 깃발 국가 나라 지역 깃발   깃발: 유럽 연합 flag: European Union 유럽연합 eu eu
🇫🇮|핀란드|flag_finland|국기 깃발 국가 나라 지역 깃발   깃발: 핀란드 flag: Finland fi
🇫🇯|피지|flag_fiji|국기 깃발 국가 나라 지역 깃발   깃발: 피지 flag: Fiji fj
🇫🇰|포클랜드 제도|flag_falkland_islands|국기 깃발 국가 나라 지역 깃발   깃발: 포클랜드 제도 flag: Falkland Islands fk
🇫🇲|미크로네시아|flag_micronesia|국기 깃발 국가 나라 지역 깃발   깃발: 미크로네시아 flag: Micronesia fm
🇫🇴|페로 제도|flag_faroe_islands|국기 깃발 국가 나라 지역 깃발   깃발: 페로 제도 flag: Faroe Islands fo
🇫🇷|프랑스|flag_france|국기 깃발 국가 나라 지역 깃발   깃발: 프랑스 flag: France fr
🇬🇦|가봉|flag_gabon|국기 깃발 국가 나라 지역 깃발   깃발: 가봉 flag: Gabon ga
🇬🇧|영국|flag_united_kingdom|국기 깃발 국가 나라 지역 깃발   깃발: 영국 flag: United Kingdom 영국 유니언잭 uk gb britain gb
🇬🇩|그레나다|flag_grenada|국기 깃발 국가 나라 지역 깃발   깃발: 그레나다 flag: Grenada gd
🇬🇪|조지아|flag_georgia|국기 깃발 국가 나라 지역 깃발   깃발: 조지아 flag: Georgia ge
🇬🇫|프랑스령 기아나|flag_french_guiana|국기 깃발 국가 나라 지역 깃발   깃발: 프랑스령 기아나 flag: French Guiana gf
🇬🇬|건지|flag_guernsey|국기 깃발 국가 나라 지역 깃발   깃발: 건지 flag: Guernsey gg
🇬🇭|가나|flag_ghana|국기 깃발 국가 나라 지역 깃발   깃발: 가나 flag: Ghana gh
🇬🇮|지브롤터|flag_gibraltar|국기 깃발 국가 나라 지역 깃발   깃발: 지브롤터 flag: Gibraltar gi
🇬🇱|그린란드|flag_greenland|국기 깃발 국가 나라 지역 깃발   깃발: 그린란드 flag: Greenland gl
🇬🇲|감비아|flag_gambia|국기 깃발 국가 나라 지역 깃발   깃발: 감비아 flag: Gambia gm
🇬🇳|기니|flag_guinea|국기 깃발 국가 나라 지역 깃발   깃발: 기니 flag: Guinea gn
🇬🇵|과들루프|flag_guadeloupe|국기 깃발 국가 나라 지역 깃발   깃발: 과들루프 flag: Guadeloupe gp
🇬🇶|적도 기니|flag_equatorial_guinea|국기 깃발 국가 나라 지역 깃발   깃발: 적도 기니 flag: Equatorial Guinea gq
🇬🇷|그리스|flag_greece|국기 깃발 국가 나라 지역 깃발   깃발: 그리스 flag: Greece gr
🇬🇸|사우스조지아 사우스샌드위치 제도|flag_south_georgia_south_sandwich_islands|국기 깃발 국가 나라 지역 깃발   깃발: 사우스조지아 사우스샌드위치 제도 flag: South Georgia & South Sandwich Islands gs
🇬🇹|과테말라|flag_guatemala|국기 깃발 국가 나라 지역 깃발   깃발: 과테말라 flag: Guatemala gt
🇬🇺|괌|flag_guam|국기 깃발 국가 나라 지역 깃발   깃발: 괌 flag: Guam gu
🇬🇼|기니비사우|flag_guinea_bissau|국기 깃발 국가 나라 지역 깃발   깃발: 기니비사우 flag: Guinea-Bissau gw
🇬🇾|가이아나|flag_guyana|국기 깃발 국가 나라 지역 깃발   깃발: 가이아나 flag: Guyana gy
🇭🇰|홍콩(중국 특별행정구)|flag_hong_kong_sar_china|국기 깃발 국가 나라 지역 깃발   깃발: 홍콩(중국 특별행정구) flag: Hong Kong SAR China hk
🇭🇲|허드 맥도널드 제도|flag_heard_mcdonald_islands|국기 깃발 국가 나라 지역 깃발   깃발: 허드 맥도널드 제도 flag: Heard & McDonald Islands hm
🇭🇳|온두라스|flag_honduras|국기 깃발 국가 나라 지역 깃발   깃발: 온두라스 flag: Honduras hn
🇭🇷|크로아티아|flag_croatia|국기 깃발 국가 나라 지역 깃발   깃발: 크로아티아 flag: Croatia hr
🇭🇹|아이티|flag_haiti|국기 깃발 국가 나라 지역 깃발   깃발: 아이티 flag: Haiti ht
🇭🇺|헝가리|flag_hungary|국기 깃발 국가 나라 지역 깃발   깃발: 헝가리 flag: Hungary hu
🇮🇨|카나리아 제도|flag_canary_islands|국기 깃발 국가 나라 지역 깃발   깃발: 카나리아 제도 flag: Canary Islands ic
🇮🇩|인도네시아|flag_indonesia|국기 깃발 국가 나라 지역 깃발   깃발: 인도네시아 flag: Indonesia id
🇮🇪|아일랜드|flag_ireland|국기 깃발 국가 나라 지역 깃발   깃발: 아일랜드 flag: Ireland ie
🇮🇱|이스라엘|flag_israel|국기 깃발 국가 나라 지역 깃발   깃발: 이스라엘 flag: Israel il
🇮🇲|맨섬|flag_isle_of_man|국기 깃발 국가 나라 지역 깃발   깃발: 맨섬 flag: Isle of Man im
🇮🇳|인도|flag_india|국기 깃발 국가 나라 지역 깃발   깃발: 인도 flag: India in
🇮🇴|영국령 인도양 지역|flag_british_indian_ocean_territory|국기 깃발 국가 나라 지역 깃발   깃발: 영국령 인도양 지역 flag: British Indian Ocean Territory io
🇮🇶|이라크|flag_iraq|국기 깃발 국가 나라 지역 깃발   깃발: 이라크 flag: Iraq iq
🇮🇷|이란|flag_iran|국기 깃발 국가 나라 지역 깃발   깃발: 이란 flag: Iran ir
🇮🇸|아이슬란드|flag_iceland|국기 깃발 국가 나라 지역 깃발   깃발: 아이슬란드 flag: Iceland is
🇮🇹|이탈리아|flag_italy|국기 깃발 국가 나라 지역 깃발   깃발: 이탈리아 flag: Italy it
🇯🇪|저지|flag_jersey|국기 깃발 국가 나라 지역 깃발   깃발: 저지 flag: Jersey je
🇯🇲|자메이카|flag_jamaica|국기 깃발 국가 나라 지역 깃발   깃발: 자메이카 flag: Jamaica jm
🇯🇴|요르단|flag_jordan|국기 깃발 국가 나라 지역 깃발   깃발: 요르단 flag: Jordan jo
🇯🇵|일본|flag_japan|국기 깃발 국가 나라 지역 깃발   깃발: 일본 flag: Japan 일본 일장기 japan jp jp
🇰🇪|케냐|flag_kenya|국기 깃발 국가 나라 지역 깃발   깃발: 케냐 flag: Kenya ke
🇰🇬|키르기스스탄|flag_kyrgyzstan|국기 깃발 국가 나라 지역 깃발   깃발: 키르기스스탄 flag: Kyrgyzstan kg
🇰🇭|캄보디아|flag_cambodia|국기 깃발 국가 나라 지역 깃발   깃발: 캄보디아 flag: Cambodia kh
🇰🇮|키리바시|flag_kiribati|국기 깃발 국가 나라 지역 깃발   깃발: 키리바시 flag: Kiribati ki
🇰🇲|코모로|flag_comoros|국기 깃발 국가 나라 지역 깃발   깃발: 코모로 flag: Comoros km
🇰🇳|세인트키츠 네비스|flag_st_kitts_nevis|국기 깃발 국가 나라 지역 깃발   깃발: 세인트키츠 네비스 flag: St. Kitts & Nevis kn
🇰🇵|북한|flag_north_korea|국기 깃발 국가 나라 지역 깃발   깃발: 북한 flag: North Korea 북한 조선 north korea kp kp
🇰🇷|대한민국|flag_south_korea|국기 깃발 국가 나라 지역 깃발   깃발: 대한민국 flag: South Korea 한국 대한민국 태극기 남한 korea kr kr
🇰🇼|쿠웨이트|flag_kuwait|국기 깃발 국가 나라 지역 깃발   깃발: 쿠웨이트 flag: Kuwait kw
🇰🇾|케이맨 제도|flag_cayman_islands|국기 깃발 국가 나라 지역 깃발   깃발: 케이맨 제도 flag: Cayman Islands ky
🇰🇿|카자흐스탄|flag_kazakhstan|국기 깃발 국가 나라 지역 깃발   깃발: 카자흐스탄 flag: Kazakhstan kz
🇱🇦|라오스|flag_laos|국기 깃발 국가 나라 지역 깃발   깃발: 라오스 flag: Laos la
🇱🇧|레바논|flag_lebanon|국기 깃발 국가 나라 지역 깃발   깃발: 레바논 flag: Lebanon lb
🇱🇨|세인트루시아|flag_st_lucia|국기 깃발 국가 나라 지역 깃발   깃발: 세인트루시아 flag: St. Lucia lc
🇱🇮|리히텐슈타인|flag_liechtenstein|국기 깃발 국가 나라 지역 깃발   깃발: 리히텐슈타인 flag: Liechtenstein li
🇱🇰|스리랑카|flag_sri_lanka|국기 깃발 국가 나라 지역 깃발   깃발: 스리랑카 flag: Sri Lanka lk
🇱🇷|라이베리아|flag_liberia|국기 깃발 국가 나라 지역 깃발   깃발: 라이베리아 flag: Liberia lr
🇱🇸|레소토|flag_lesotho|국기 깃발 국가 나라 지역 깃발   깃발: 레소토 flag: Lesotho ls
🇱🇹|리투아니아|flag_lithuania|국기 깃발 국가 나라 지역 깃발   깃발: 리투아니아 flag: Lithuania lt
🇱🇺|룩셈부르크|flag_luxembourg|국기 깃발 국가 나라 지역 깃발   깃발: 룩셈부르크 flag: Luxembourg lu
🇱🇻|라트비아|flag_latvia|국기 깃발 국가 나라 지역 깃발   깃발: 라트비아 flag: Latvia lv
🇱🇾|리비아|flag_libya|국기 깃발 국가 나라 지역 깃발   깃발: 리비아 flag: Libya ly
🇲🇦|모로코|flag_morocco|국기 깃발 국가 나라 지역 깃발   깃발: 모로코 flag: Morocco ma
🇲🇨|모나코|flag_monaco|국기 깃발 국가 나라 지역 깃발   깃발: 모나코 flag: Monaco mc
🇲🇩|몰도바|flag_moldova|국기 깃발 국가 나라 지역 깃발   깃발: 몰도바 flag: Moldova md
🇲🇪|몬테네그로|flag_montenegro|국기 깃발 국가 나라 지역 깃발   깃발: 몬테네그로 flag: Montenegro me
🇲🇫|생마르탱|flag_st_martin|국기 깃발 국가 나라 지역 깃발   깃발: 생마르탱 flag: St. Martin mf
🇲🇬|마다가스카르|flag_madagascar|국기 깃발 국가 나라 지역 깃발   깃발: 마다가스카르 flag: Madagascar mg
🇲🇭|마셜 제도|flag_marshall_islands|국기 깃발 국가 나라 지역 깃발   깃발: 마셜 제도 flag: Marshall Islands mh
🇲🇰|북마케도니아|flag_north_macedonia|국기 깃발 국가 나라 지역 깃발   깃발: 북마케도니아 flag: North Macedonia mk
🇲🇱|말리|flag_mali|국기 깃발 국가 나라 지역 깃발   깃발: 말리 flag: Mali ml
🇲🇲|미얀마|flag_myanmar_burma|국기 깃발 국가 나라 지역 깃발   깃발: 미얀마 flag: Myanmar (Burma) mm
🇲🇳|몽골|flag_mongolia|국기 깃발 국가 나라 지역 깃발   깃발: 몽골 flag: Mongolia mn
🇲🇴|마카오(중국 특별행정구)|flag_macao_sar_china|국기 깃발 국가 나라 지역 깃발   깃발: 마카오(중국 특별행정구) flag: Macao SAR China mo
🇲🇵|북마리아나제도|flag_northern_mariana_islands|국기 깃발 국가 나라 지역 깃발   깃발: 북마리아나제도 flag: Northern Mariana Islands mp
🇲🇶|마르티니크|flag_martinique|국기 깃발 국가 나라 지역 깃발   깃발: 마르티니크 flag: Martinique mq
🇲🇷|모리타니|flag_mauritania|국기 깃발 국가 나라 지역 깃발   깃발: 모리타니 flag: Mauritania mr
🇲🇸|몬트세라트|flag_montserrat|국기 깃발 국가 나라 지역 깃발   깃발: 몬트세라트 flag: Montserrat ms
🇲🇹|몰타|flag_malta|국기 깃발 국가 나라 지역 깃발   깃발: 몰타 flag: Malta mt
🇲🇺|모리셔스|flag_mauritius|국기 깃발 국가 나라 지역 깃발   깃발: 모리셔스 flag: Mauritius mu
🇲🇻|몰디브|flag_maldives|국기 깃발 국가 나라 지역 깃발   깃발: 몰디브 flag: Maldives mv
🇲🇼|말라위|flag_malawi|국기 깃발 국가 나라 지역 깃발   깃발: 말라위 flag: Malawi mw
🇲🇽|멕시코|flag_mexico|국기 깃발 국가 나라 지역 깃발   깃발: 멕시코 flag: Mexico mx
🇲🇾|말레이시아|flag_malaysia|국기 깃발 국가 나라 지역 깃발   깃발: 말레이시아 flag: Malaysia my
🇲🇿|모잠비크|flag_mozambique|국기 깃발 국가 나라 지역 깃발   깃발: 모잠비크 flag: Mozambique mz
🇳🇦|나미비아|flag_namibia|국기 깃발 국가 나라 지역 깃발   깃발: 나미비아 flag: Namibia na
🇳🇨|뉴칼레도니아|flag_new_caledonia|국기 깃발 국가 나라 지역 깃발   깃발: 뉴칼레도니아 flag: New Caledonia nc
🇳🇪|니제르|flag_niger|국기 깃발 국가 나라 지역 깃발   깃발: 니제르 flag: Niger ne
🇳🇫|노퍽섬|flag_norfolk_island|국기 깃발 국가 나라 지역 깃발   깃발: 노퍽섬 flag: Norfolk Island nf
🇳🇬|나이지리아|flag_nigeria|국기 깃발 국가 나라 지역 깃발   깃발: 나이지리아 flag: Nigeria ng
🇳🇮|니카라과|flag_nicaragua|국기 깃발 국가 나라 지역 깃발   깃발: 니카라과 flag: Nicaragua ni
🇳🇱|네덜란드|flag_netherlands|국기 깃발 국가 나라 지역 깃발   깃발: 네덜란드 flag: Netherlands nl
🇳🇴|노르웨이|flag_norway|국기 깃발 국가 나라 지역 깃발   깃발: 노르웨이 flag: Norway no
🇳🇵|네팔|flag_nepal|국기 깃발 국가 나라 지역 깃발   깃발: 네팔 flag: Nepal np
🇳🇷|나우루|flag_nauru|국기 깃발 국가 나라 지역 깃발   깃발: 나우루 flag: Nauru nr
🇳🇺|니우에|flag_niue|국기 깃발 국가 나라 지역 깃발   깃발: 니우에 flag: Niue nu
🇳🇿|뉴질랜드|flag_new_zealand|국기 깃발 국가 나라 지역 깃발   깃발: 뉴질랜드 flag: New Zealand nz
🇴🇲|오만|flag_oman|국기 깃발 국가 나라 지역 깃발   깃발: 오만 flag: Oman om
🇵🇦|파나마|flag_panama|국기 깃발 국가 나라 지역 깃발   깃발: 파나마 flag: Panama pa
🇵🇪|페루|flag_peru|국기 깃발 국가 나라 지역 깃발   깃발: 페루 flag: Peru pe
🇵🇫|프랑스령 폴리네시아|flag_french_polynesia|국기 깃발 국가 나라 지역 깃발   깃발: 프랑스령 폴리네시아 flag: French Polynesia pf
🇵🇬|파푸아뉴기니|flag_papua_new_guinea|국기 깃발 국가 나라 지역 깃발   깃발: 파푸아뉴기니 flag: Papua New Guinea pg
🇵🇭|필리핀|flag_philippines|국기 깃발 국가 나라 지역 깃발   깃발: 필리핀 flag: Philippines ph
🇵🇰|파키스탄|flag_pakistan|국기 깃발 국가 나라 지역 깃발   깃발: 파키스탄 flag: Pakistan pk
🇵🇱|폴란드|flag_poland|국기 깃발 국가 나라 지역 깃발   깃발: 폴란드 flag: Poland pl
🇵🇲|생피에르 미클롱|flag_st_pierre_miquelon|국기 깃발 국가 나라 지역 깃발   깃발: 생피에르 미클롱 flag: St. Pierre & Miquelon pm
🇵🇳|핏케언 제도|flag_pitcairn_islands|국기 깃발 국가 나라 지역 깃발   깃발: 핏케언 제도 flag: Pitcairn Islands pn
🇵🇷|푸에르토리코|flag_puerto_rico|국기 깃발 국가 나라 지역 깃발   깃발: 푸에르토리코 flag: Puerto Rico pr
🇵🇸|팔레스타인 지구|flag_palestinian_territories|국기 깃발 국가 나라 지역 깃발   깃발: 팔레스타인 지구 flag: Palestinian Territories ps
🇵🇹|포르투갈|flag_portugal|국기 깃발 국가 나라 지역 깃발   깃발: 포르투갈 flag: Portugal pt
🇵🇼|팔라우|flag_palau|국기 깃발 국가 나라 지역 깃발   깃발: 팔라우 flag: Palau pw
🇵🇾|파라과이|flag_paraguay|국기 깃발 국가 나라 지역 깃발   깃발: 파라과이 flag: Paraguay py
🇶🇦|카타르|flag_qatar|국기 깃발 국가 나라 지역 깃발   깃발: 카타르 flag: Qatar qa
🇷🇪|레위니옹|flag_r_union|국기 깃발 국가 나라 지역 깃발   깃발: 레위니옹 flag: Réunion re
🇷🇴|루마니아|flag_romania|국기 깃발 국가 나라 지역 깃발   깃발: 루마니아 flag: Romania ro
🇷🇸|세르비아|flag_serbia|국기 깃발 국가 나라 지역 깃발   깃발: 세르비아 flag: Serbia rs
🇷🇺|러시아|flag_russia|국기 깃발 국가 나라 지역 깃발   깃발: 러시아 flag: Russia ru
🇷🇼|르완다|flag_rwanda|국기 깃발 국가 나라 지역 깃발   깃발: 르완다 flag: Rwanda rw
🇸🇦|사우디아라비아|flag_saudi_arabia|국기 깃발 국가 나라 지역 깃발   깃발: 사우디아라비아 flag: Saudi Arabia sa
🇸🇧|솔로몬 제도|flag_solomon_islands|국기 깃발 국가 나라 지역 깃발   깃발: 솔로몬 제도 flag: Solomon Islands sb
🇸🇨|세이셸|flag_seychelles|국기 깃발 국가 나라 지역 깃발   깃발: 세이셸 flag: Seychelles sc
🇸🇩|수단|flag_sudan|국기 깃발 국가 나라 지역 깃발   깃발: 수단 flag: Sudan sd
🇸🇪|스웨덴|flag_sweden|국기 깃발 국가 나라 지역 깃발   깃발: 스웨덴 flag: Sweden se
🇸🇬|싱가포르|flag_singapore|국기 깃발 국가 나라 지역 깃발   깃발: 싱가포르 flag: Singapore sg
🇸🇭|세인트헬레나|flag_st_helena|국기 깃발 국가 나라 지역 깃발   깃발: 세인트헬레나 flag: St. Helena sh
🇸🇮|슬로베니아|flag_slovenia|국기 깃발 국가 나라 지역 깃발   깃발: 슬로베니아 flag: Slovenia si
🇸🇯|스발바르제도-얀마웬섬|flag_svalbard_jan_mayen|국기 깃발 국가 나라 지역 깃발   깃발: 스발바르제도-얀마웬섬 flag: Svalbard & Jan Mayen sj
🇸🇰|슬로바키아|flag_slovakia|국기 깃발 국가 나라 지역 깃발   깃발: 슬로바키아 flag: Slovakia sk
🇸🇱|시에라리온|flag_sierra_leone|국기 깃발 국가 나라 지역 깃발   깃발: 시에라리온 flag: Sierra Leone sl
🇸🇲|산마리노|flag_san_marino|국기 깃발 국가 나라 지역 깃발   깃발: 산마리노 flag: San Marino sm
🇸🇳|세네갈|flag_senegal|국기 깃발 국가 나라 지역 깃발   깃발: 세네갈 flag: Senegal sn
🇸🇴|소말리아|flag_somalia|국기 깃발 국가 나라 지역 깃발   깃발: 소말리아 flag: Somalia so
🇸🇷|수리남|flag_suriname|국기 깃발 국가 나라 지역 깃발   깃발: 수리남 flag: Suriname sr
🇸🇸|남수단|flag_south_sudan|국기 깃발 국가 나라 지역 깃발   깃발: 남수단 flag: South Sudan ss
🇸🇹|상투메 프린시페|flag_s_o_tom_pr_ncipe|국기 깃발 국가 나라 지역 깃발   깃발: 상투메 프린시페 flag: São Tomé & Príncipe st
🇸🇻|엘살바도르|flag_el_salvador|국기 깃발 국가 나라 지역 깃발   깃발: 엘살바도르 flag: El Salvador sv
🇸🇽|신트마르턴|flag_sint_maarten|국기 깃발 국가 나라 지역 깃발   깃발: 신트마르턴 flag: Sint Maarten sx
🇸🇾|시리아|flag_syria|국기 깃발 국가 나라 지역 깃발   깃발: 시리아 flag: Syria sy
🇸🇿|에스와티니|flag_eswatini|국기 깃발 국가 나라 지역 깃발   깃발: 에스와티니 flag: Eswatini sz
🇹🇦|트리스탄다쿠나|flag_tristan_da_cunha|국기 깃발 국가 나라 지역 깃발   깃발: 트리스탄다쿠나 flag: Tristan da Cunha ta
🇹🇨|터크스 케이커스 제도|flag_turks_caicos_islands|국기 깃발 국가 나라 지역 깃발   깃발: 터크스 케이커스 제도 flag: Turks & Caicos Islands tc
🇹🇩|차드|flag_chad|국기 깃발 국가 나라 지역 깃발   깃발: 차드 flag: Chad td
🇹🇫|프랑스령 남방 지역|flag_french_southern_territories|국기 깃발 국가 나라 지역 깃발   깃발: 프랑스령 남방 지역 flag: French Southern Territories tf
🇹🇬|토고|flag_togo|국기 깃발 국가 나라 지역 깃발   깃발: 토고 flag: Togo tg
🇹🇭|태국|flag_thailand|국기 깃발 국가 나라 지역 깃발   깃발: 태국 flag: Thailand th
🇹🇯|타지키스탄|flag_tajikistan|국기 깃발 국가 나라 지역 깃발   깃발: 타지키스탄 flag: Tajikistan tj
🇹🇰|토켈라우|flag_tokelau|국기 깃발 국가 나라 지역 깃발   깃발: 토켈라우 flag: Tokelau tk
🇹🇱|동티모르|flag_timor_leste|국기 깃발 국가 나라 지역 깃발   깃발: 동티모르 flag: Timor-Leste tl
🇹🇲|투르크메니스탄|flag_turkmenistan|국기 깃발 국가 나라 지역 깃발   깃발: 투르크메니스탄 flag: Turkmenistan tm
🇹🇳|튀니지|flag_tunisia|국기 깃발 국가 나라 지역 깃발   깃발: 튀니지 flag: Tunisia tn
🇹🇴|통가|flag_tonga|국기 깃발 국가 나라 지역 깃발   깃발: 통가 flag: Tonga to
🇹🇷|튀르키예|flag_t_rkiye|국기 깃발 국가 나라 지역 깃발   깃발: 튀르키예 flag: Türkiye tr
🇹🇹|트리니다드 토바고|flag_trinidad_tobago|국기 깃발 국가 나라 지역 깃발   깃발: 트리니다드 토바고 flag: Trinidad & Tobago tt
🇹🇻|투발루|flag_tuvalu|국기 깃발 국가 나라 지역 깃발   깃발: 투발루 flag: Tuvalu tv
🇹🇼|대만|flag_taiwan|국기 깃발 국가 나라 지역 깃발   깃발: 대만 flag: Taiwan 대만 타이완 taiwan tw tw
🇹🇿|탄자니아|flag_tanzania|국기 깃발 국가 나라 지역 깃발   깃발: 탄자니아 flag: Tanzania tz
🇺🇦|우크라이나|flag_ukraine|국기 깃발 국가 나라 지역 깃발   깃발: 우크라이나 flag: Ukraine ua
🇺🇬|우간다|flag_uganda|국기 깃발 국가 나라 지역 깃발   깃발: 우간다 flag: Uganda ug
🇺🇲|미국령 해외 제도|flag_u_s_outlying_islands|국기 깃발 국가 나라 지역 깃발   깃발: 미국령 해외 제도 flag: U.S. Outlying Islands um
🇺🇳|국제연합|flag_united_nations|국기 깃발 국가 나라 지역 깃발   깃발: 국제연합 flag: United Nations 유엔 국제연합 un un
🇺🇸|미국|flag_united_states|국기 깃발 국가 나라 지역 깃발   깃발: 미국 flag: United States 미국 성조기 usa us america us
🇺🇾|우루과이|flag_uruguay|국기 깃발 국가 나라 지역 깃발   깃발: 우루과이 flag: Uruguay uy
🇺🇿|우즈베키스탄|flag_uzbekistan|국기 깃발 국가 나라 지역 깃발   깃발: 우즈베키스탄 flag: Uzbekistan uz
🇻🇦|바티칸 시국|flag_vatican_city|국기 깃발 국가 나라 지역 깃발   깃발: 바티칸 시국 flag: Vatican City va
🇻🇨|세인트빈센트그레나딘|flag_st_vincent_grenadines|국기 깃발 국가 나라 지역 깃발   깃발: 세인트빈센트그레나딘 flag: St. Vincent & Grenadines vc
🇻🇪|베네수엘라|flag_venezuela|국기 깃발 국가 나라 지역 깃발   깃발: 베네수엘라 flag: Venezuela ve
🇻🇬|영국령 버진아일랜드|flag_british_virgin_islands|국기 깃발 국가 나라 지역 깃발   깃발: 영국령 버진아일랜드 flag: British Virgin Islands vg
🇻🇮|미국령 버진아일랜드|flag_u_s_virgin_islands|국기 깃발 국가 나라 지역 깃발   깃발: 미국령 버진아일랜드 flag: U.S. Virgin Islands vi
🇻🇳|베트남|flag_vietnam|국기 깃발 국가 나라 지역 깃발   깃발: 베트남 flag: Vietnam vn
🇻🇺|바누아투|flag_vanuatu|국기 깃발 국가 나라 지역 깃발   깃발: 바누아투 flag: Vanuatu vu
🇼🇫|왈리스-푸투나 제도|flag_wallis_futuna|국기 깃발 국가 나라 지역 깃발   깃발: 왈리스-푸투나 제도 flag: Wallis & Futuna wf
🇼🇸|사모아|flag_samoa|국기 깃발 국가 나라 지역 깃발   깃발: 사모아 flag: Samoa ws
🇽🇰|코소보|flag_kosovo|국기 깃발 국가 나라 지역 깃발   깃발: 코소보 flag: Kosovo xk
🇾🇪|예멘|flag_yemen|국기 깃발 국가 나라 지역 깃발   깃발: 예멘 flag: Yemen ye
🇾🇹|마요트|flag_mayotte|국기 깃발 국가 나라 지역 깃발   깃발: 마요트 flag: Mayotte yt
🇿🇦|남아프리카|flag_south_africa|국기 깃발 국가 나라 지역 깃발   깃발: 남아프리카 flag: South Africa za
🇿🇲|잠비아|flag_zambia|국기 깃발 국가 나라 지역 깃발   깃발: 잠비아 flag: Zambia zm
🇿🇼|짐바브웨|flag_zimbabwe|국기 깃발 국가 나라 지역 깃발   깃발: 짐바브웨 flag: Zimbabwe zw
🏴󠁧󠁢󠁥󠁮󠁧󠁿|잉글랜드|flag_england|국기 깃발 국가 나라 지역 깃발   깃발: 잉글랜드 flag: England
🏴󠁧󠁢󠁳󠁣󠁴󠁿|스코틀랜드|flag_scotland|국기 깃발 국가 나라 지역 깃발   깃발: 스코틀랜드 flag: Scotland
🏴󠁧󠁢󠁷󠁬󠁳󠁿|웨일즈|flag_wales|국기 깃발 국가 나라 지역 깃발   깃발: 웨일즈 flag: Wales`),
  },
];
