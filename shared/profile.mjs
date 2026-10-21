export class AppError extends Error { constructor(status, message, code = '') { super(message); this.status = status; this.code = code; } }
const fail = (status,message,code) => { throw new AppError(status,message,code); };
const DISTRICTS = ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'];
export const phone = value => {
  let v = String(value || '').replace(/[^\d+]/g, '');
  if (/^01[016789]\d{7,8}$/.test(v)) v = '+82' + v.slice(1);
  if (/^82/.test(v)) v = '+' + v;
  if (!/^\+821[016789]\d{7,8}$/.test(v)) fail(400, '휴대폰 번호를 확인해주세요.');
  return v;
};
export function ownedPath(value, user, slot) {
  if (!value) return null;
  const prefix = user.id + '/' + slot + '/';
  if (typeof value !== 'string' || !value.startsWith(prefix) || !/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(value.slice(prefix.length)) || (slot !== 'employment' && value.endsWith('.pdf'))) fail(400,'첨부 파일 정보를 확인해주세요.');
  return value;
}
export function publicProfile(value) {
  if (!value) return null;
  const profile = {...value};
  for (const field of ['religion','smoking','drinking','sensitive_consent_at']) delete profile[field];
  return profile;
}
export function cleanProfile(body, user) {
  const text = (name, max = 100, required = false) => {
    const v = String(body[name] || '').trim();
    if (v.length > max || (required && !v)) fail(400, '필수 항목과 입력 길이를 확인해주세요.');
    return v || null;
  };
  const enumValue = (name, allowed, required = false) => { const value = text(name); if (value && !allowed.includes(value)) fail(400, '선택 항목을 확인해주세요.'); if (required && !value) fail(400, '필수 항목을 확인해주세요.'); return value; };
  const number = (name, min, max, required = false) => { if (body[name] === '' || body[name] === undefined || body[name] === null) { if (required) fail(400, '키를 입력해주세요.'); return null; } const v = Number(body[name]); if (!Number.isFinite(v) || v < min || v > max) fail(400, '키와 몸무게를 확인해주세요.'); return v; };
  const birth = text('birth', 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !Number.isFinite(Date.parse(birth)) || new Date(birth).toISOString().slice(0,10) !== birth || birth < '1900-01-01' || birth > new Date().toISOString().slice(0,10)) fail(400, '생년월일을 확인해주세요.');
  if (body.privacyConsent !== true) fail(400, '프로필 저장을 위한 개인정보 수집·이용 안내를 확인하고 동의해주세요.');
  const mbti = text('mbti', 10);
  if (mbti && mbti !== '잘 모르겠어요' && !/^[EI][SN][TF][JP]$/.test(mbti)) fail(400, 'MBTI를 확인해주세요.');
  const region = enumValue('region',['서울','경기','인천','그 외 지역'],true);
  const district = region === '서울' ? enumValue('district',DISTRICTS,true) : null;
  const attachments = body.attachments || {};
  const face_path = ownedPath(attachments.face,user,'face'), fullbody_path = ownedPath(attachments.fullbody,user,'fullbody'), employment_path = ownedPath(attachments.employment,user,'employment');
  if ((face_path || fullbody_path) && body.photoConsent !== true) fail(400,'사진 확인·저장 안내에 동의해주세요.');
  if (employment_path && body.employmentConsent !== true) fail(400,'직업 자료 확인·저장 안내에 동의해주세요.');
  const now = new Date().toISOString();
  // Clear retired nullable columns on each save, including requests from older screens.
  return {user_id:user.id, kind:user.email ? 'member' : 'guest', name:text('name',30,true), phone:phone((!!user.phone_confirmed_at && !!user.phone) ? user.phone : body.phone), phone_verified:(!!user.phone_confirmed_at && !!user.phone), birth, gender:enumValue('gender',['여성','남성'],true), height:number('height',120,230,true), weight:number('weight',25,250), region, district, mbti, job:text('job',60,true), religion:null, smoking:null, drinking:null, sensitive_consent_at:null, face_path, fullbody_path, employment_path, privacy_consent_at:now, photo_consent_at:face_path || fullbody_path ? now : null, employment_consent_at:employment_path ? now : null, updated_at:now};
}
