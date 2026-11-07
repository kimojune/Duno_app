-- 원샷 v2 고침 3바퀴: 처음 정한 비율에 「기타」를 넣는다(PM 답 d-69 「기타 분야 넣어」).
-- 더하기만 한다: user_settings에 열 하나(ratio_other_percent)와 그 열의 insert·update 권한. 기존 열·데이터는 건드리지 않는다.
-- 기타는 분야 표(category_ratios)에 둘 수 없다(그 표의 category_id는 categories를 가리키는 외래 키이고 기타는 분야가 아니다).
-- null이면 기타 몫이 없다(기존 사용자 모두). 앱은 이 열을 못 읽어도(적용 전) 기타 몫 없음으로 돌고, 기타를 쓰는 사용자의 저장만 이 마이그레이션이 필요하다.
-- 앞 파일에 기대는 것: 20261107100200_user_settings.sql(user_settings 표).

alter table public.user_settings
  add column ratio_other_percent smallint null;

alter table public.user_settings
  add constraint user_settings_ratio_other_range check (ratio_other_percent is null or ratio_other_percent between 0 and 100);

comment on column public.user_settings.ratio_other_percent is '처음 정한 비율의 기타 몫(%). null이면 기타 몫 없음. 분야 몫은 category_ratios.';

-- 열 단위 권한(앞 마이그레이션과 같은 꼴): 새 열도 insert·update 목록에 넣는다. upsert의 DO UPDATE SET에도 실려 update 권한이 필요하다.
grant insert (ratio_other_percent) on table public.user_settings to authenticated;
grant update (ratio_other_percent) on table public.user_settings to authenticated;
