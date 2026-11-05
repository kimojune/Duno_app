-- 두노 todos: insert 때 id를 클라이언트가 정할 수 있게 한다(3단계 서버, 디자인 명세 D4).
-- 이유: 적기를 다시 보내도(재시도·「다시」) 같은 할 일이 두 번 생기지 않게, 화면이 만든 uuid를 행의 id로 쓴다.
-- 같은 id가 이미 있으면 기본 키 제약이 두 번째 insert를 막는다. 열은 더하지 않는다.
-- update로 id를 바꾸는 권한은 여전히 없다(update는 done만).
grant insert (id) on table public.todos to authenticated;
