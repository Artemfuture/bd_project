EDU.registerModule('home', {
  async render(host) {
    const { h } = EDU;
    const me = EDU.me;
    const isStudent = me.role === 'student';
    const canReview = me.role === 'staff';
    const hour = new Date().getHours();
    const greet =
      hour < 5 ? 'Доброй ночи' :
      hour < 12 ? 'Доброе утро' :
      hour < 18 ? 'Добрый день' :
      'Добрый вечер';
    const refresh = () => EDU.show('home');
    const heroStats = h(
      'div',
      { class: 'dash3-hero-stats' },
      EDU.skeleton(2)
    );
    const activityBody = h(
      'div',
      { class: 'dash3-list-body' },
      EDU.skeleton(4)
    );
    const eventsBody = h(
      'div',
      { class: 'dash3-events-body' },
      EDU.skeleton(4)
    );
    const lead = h(
      'p',
      { class: 'dash3-lead' },
      'Загружаю данные…'
    );
    const moreLink = (text, module) =>
      h(
        'a',
        {
          class: 'dash3-more',
          href: '#',
          onclick: (e) => {
            e.preventDefault();
            EDU.show(module);
          }
        },
        text,
        h(
          'span',
          { 'aria-hidden': 'true' },
          '→'
        )
      );
    host.replaceChildren(
      h(
        'section',
        {
          class:
            `dash3-hero ${isStudent ? 'student' : 'staff'}`
        },
        h(
          'div',
          { class: 'dash3-hero-copy' },
          h(
            'span',
            { class: 'dash3-kicker' },
            isStudent
              ? 'Личный кабинет'
              : 'Рабочий стол деканата'
          ),
          h(
            'h1',
            {},
            `${greet}, ${EDU.firstName(me.full_name)}`
          ),
          lead
        ),
        heroStats
      ),
      h(
        'div',
        { class: 'dash3-grid' },
        h(
          'section',
          {
            class:
              'dash3-panel dash3-activity'
          },
          h(
            'div',
            { class: 'dash3-panel-head' },
            h(
              'div',
              {},
              h(
                'span',
                { class: 'dash3-eyebrow' },
                isStudent
                  ? 'Активность'
                  : 'Работа с заявками'
              ),
              h(
                'h2',
                {},
                isStudent
                  ? 'Последние достижения'
                  : 'Очередь проверки'
              )
            ),
            moreLink(
              isStudent
                ? 'Все достижения'
                : 'Открыть реестр',
              isStudent
                ? 'achievements'
                : 'review'
            )
          ),
          activityBody
        ),
        h(
          'section',
          {
            class:
              'dash3-panel dash3-events'
          },
          h(
            'div',
            { class: 'dash3-panel-head' },
            h(
              'div',
              {},
              h(
                'span',
                { class: 'dash3-eyebrow' },
                'Календарь'
              ),
              h(
                'h2',
                {},
                'Ближайшие мероприятия'
              )
            ),
            moreLink(
              'Все',
              'events'
            )
          ),
          eventsBody
        )
      )
    );
    const [summary, events] =
      await Promise.all([
        EDU.api('/home/summary'),
        EDU
          .api('/events/upcoming?days=21')
          .catch(() => [])
      ]);
    const counts =
      summary.counts || {};
    const pending =
      counts['under review'] || 0;
    const confirmed =
      counts.confirmed || 0;
    const rejected =
      counts.rejected || 0;
    if (isStudent) {
      const rating =
        summary.rating || {};
      const recent =
        summary.recent || [];
      const points =
        EDU.pts(rating.total_points);
      const groupRank =
        rating.rank_in_group
          ? `${rating.rank_in_group} / ${summary.group_size}`
          : '—';
      const directionRank =
        rating.rank_in_direction ?? '—';
      lead.textContent =
        rating.rank_in_group
          ? `Сейчас вы на ${rating.rank_in_group} месте в группе из ${summary.group_size}.`
          : recent.length
            ? 'Баллы появятся после подтверждения достижений.'
            : 'Добавьте первое достижение и начните собирать портфолио.';
      heroStats.replaceChildren(
        h(
          'div',
          {
            class:
              'dash3-stat primary'
          },
          h(
            'span',
            {},
            'Баллы'
          ),
          h(
            'strong',
            {},
            points
          )
        ),
        h(
          'button',
          {
            type: 'button',
            class:
              'dash3-stat linklike',
            onclick: () =>
              EDU.show('rating')
          },
          h(
            'span',
            {},
            'В группе'
          ),
          h(
            'strong',
            {},
            groupRank
          )
        ),
        h(
          'button',
          {
            type: 'button',
            class:
              'dash3-stat linklike',
            onclick: () =>
              EDU.show('rating')
          },
          h(
            'span',
            {},
            'На направлении'
          ),
          h(
            'strong',
            {},
            directionRank
          )
        ),
        h(
          'div',
          {
            class:
              'dash3-statuses'
          },
          h(
            'span',
            { class: 'ok' },
            h('i', {}),
            `${confirmed} подтверждено`
          ),
          h(
            'span',
            { class: 'wait' },
            h('i', {}),
            `${pending} на проверке`
          ),
          h(
            'span',
            { class: 'bad' },
            h('i', {}),
            `${rejected} отклонено`
          )
        )
      );
      activityBody.replaceChildren(
        recent.length
          ? h(
              'div',
              {
                class:
                  'timeline dash3-timeline'
              },
              ...recent.map((a) =>
                EDU.achRow(
                  a,
                  {
                    onclick: () =>
                      EDU.openAchievement(
                        a.achievement_id,
                        refresh
                      )
                  }
                )
              )
            )
          : h(
              'div',
              {
                class:
                  'dash3-empty'
              },
              h(
                'strong',
                {},
                'Пока здесь пусто'
              ),
              h(
                'span',
                {},
                'Новое достижение можно добавить кнопкой в левом меню.'
              )
            )
      );
    }
    else {
      const queue =
        summary.queue || [];
      const total =
        pending +
        confirmed +
        rejected;
      lead.textContent =
        pending
          ? `В очереди ${pending} ${
              pending === 1
                ? 'заявка'
                : 'заявки'
            }. ${
              canReview
                ? 'Начните с самых давних.'
                : 'Доступен просмотр очереди.'
            }`
          : 'Очередь пуста — все поступившие заявки обработаны.';
      heroStats.replaceChildren(
        h(
          'button',
          {
            type: 'button',
            class:
              'dash3-stat primary linklike',
            onclick: () =>
              EDU.show('review')
          },
          h(
            'span',
            {},
            'На проверке'
          ),
          h(
            'strong',
            {
              class:
                pending
                  ? 'danger'
                  : ''
            },
            pending
          )
        ),
        h(
          'div',
          {
            class:
              'dash3-stat'
          },
          h(
            'span',
            {},
            'Подтверждено'
          ),
          h(
            'strong',
            {},
            confirmed
          )
        ),
        h(
          'div',
          {
            class:
              'dash3-stat'
          },
          h(
            'span',
            {},
            'Отклонено'
          ),
          h(
            'strong',
            {},
            rejected
          )
        ),
        h(
          'div',
          {
            class:
              'dash3-stat'
          },
          h(
            'span',
            {},
            'Всего заявок'
          ),
          h(
            'strong',
            {},
            total
          )
        )
      );
      activityBody.replaceChildren(
        queue.length
          ? h(
              'div',
              {
                class:
                  'timeline dash3-timeline'
              },
              ...queue.map((a) =>
                EDU.achRow(
                  a,
                  {
                    who: true,
                    onclick: () =>
                      EDU.openAchievement(
                        a.achievement_id,
                        refresh
                      )
                  }
                )
              )
            )
          : h(
              'div',
              {
                class:
                  'dash3-empty'
              },
              h(
                'strong',
                {},
                'Всё проверено'
              ),
              h(
                'span',
                {},
                'Новых заявок в очереди сейчас нет.'
              )
            )
      );
    }
    const eventItems =
      events
        .slice(0, 5)
        .map((e) => {
          const date =
            EDU.date(e.start_date);
          const month =
            date
              .toLocaleString(
                'ru-RU',
                { month: 'short' }
              )
              .replace('.', '');
          const meta = [
            EDU.lbl(
              'event_type',
              e.event_type
            ),
            EDU.lbl(
              'level',
              e.level
            ),
            e.place
          ]
            .filter(Boolean)
            .join(' · ');
          return h(
            'button',
            {
              type: 'button',
              class:
                `dash3-event t-${e.event_type}`,
              onclick: () =>
                EDU.show('events')
            },
            h(
              'span',
              {
                class:
                  'dash3-event-date'
              },
              h(
                'b',
                {},
                String(date.getDate())
              ),
              h(
                'small',
                {},
                month
              )
            ),
            h(
              'span',
              {
                class:
                  'dash3-event-copy'
              },
              h(
                'b',
                {},
                e.title
              ),
              h(
                'small',
                {},
                meta
              )
            ),
            h(
              'span',
              {
                class:
                  'dash3-event-arrow',
                'aria-hidden':
                  'true'
              },
              '→'
            )
          );
        });
    eventsBody.replaceChildren(
      eventItems.length
        ? h(
            'div',
            {
              class:
                'dash3-event-list'
            },
            ...eventItems
          )
        : h(
            'div',
            {
              class:
                'dash3-empty compact'
            },
            h(
              'strong',
              {},
              'Событий пока нет'
            ),
            h(
              'span',
              {},
              'В ближайшие три недели мероприятий не найдено.'
            )
          )
    );
  }
});
