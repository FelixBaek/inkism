import {t} from '../../i18n';
export function playbackFailure(error:MediaError|null):string {
 if(typeof navigator!=='undefined'&&navigator.onLine===false)return t('오프라인입니다. 연결 후 다시 시도해 주세요.');
 if(error?.code===3)return t('미디어를 해석하지 못했습니다. 파일이나 형식을 확인해 주세요.');
 if(error?.code===4)return t('파일을 불러올 수 없거나 지원하지 않는 미디어 형식입니다.');
 return t('미디어를 불러오지 못했습니다. 파일과 연결 상태를 확인해 주세요.');
}
