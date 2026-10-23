EDU.registerModule('search', {
  async render(host) {
    const { h } = EDU;
    const q =
      (EDU.searchQuery || '').trim();
    EDU.setCrumbs(['Поиск']);
    const results = h(
      'div',
      {
        class: 'search3-results'
      },
      EDU.skeleton(3)
    );
    const hero = h(
      'section',
      {
        class: 'search3-hero'
      },
      h(
        'div',
        {
          class: 'search3-hero-copy'
        },
        h(
          'span',
          {
            class: 'search3-kicker'
          },
          'Глобальный поиск'
        ),
        h(
          'h1',
          {},
          'Поиск'
        ),
        h(
          'p',
          {},
          q
            ? `Результаты по запросу «${q}»`
            : 'Введите запрос в строке поиска сверху.'
        )
      ),
      h(
        'div',
        {
          class: 'search3-query'
        },
        h(
          'span',
          {},
          'Запрос'
        ),
        h(
          'strong',
          {},
          q || '—'
        )
      )
    );
    host.replaceChildren(
      hero,
      results
    );
    if (!q) {
      results.replaceChildren(
        h(
          'div',
          {
            class: 'search3-empty'
          },
          h(
            'div',
            {
              class: 'search3-empty-icon'
            },
            '⌕'
          ),
          h(
            'strong',
            {},
            'Начните поиск'
          ),
          h(
            'span',
            {},
            'Введите название достижения, мероприятия или имя студента.'
          )
        )
      );
      return;
    }
    let r;
    try {
      r = await EDU.api(
        '/search?q=' +
        encodeURIComponent(q)
      );
    }
    catch (e) {
      EDU.fail(
        results,
        e
      );
      return;
    }
    const achievements =
      r.achievements || [];
    const students =
      r.students || [];
    const events =
      r.events || [];
    const total =
      achievements.length +
      students.length +
      events.length;
    const section = (
      type,
      title,
      count,
      node
    ) => {
      if (!count) {
        return '';
      }
      return h(
        'section',
        {
          class:
            `search3-section ${type}`
        },
        h(
          'div',
          {
            class:
              'search3-section-head'
          },
          h(
            'div',
            {},
            h(
              'span',
              {
                class:
                  'search3-eyebrow'
              },
              type === 'achievements'
                ? 'Портфолио'
                : type === 'students'
                  ? 'Пользователи'
                  : 'Календарь'
            ),
            h(
              'h2',
              {},
              title
            )
          ),
          h(
            'span',
            {
              class:
                'search3-count'
            },
            String(count)
          )
        ),
        node
      );
    };
    const achievementsBlock =
      section(
        'achievements',
        'Достижения',
        achievements.length,
        h(
          'div',
          {
            class:
              'timeline search3-timeline'
          },
          ...achievements.map(
            a =>
              EDU.achRow(
                a,
                {
                  who:
                    EDU.me.role !==
                    'student',
                  onclick:
                    () =>
                      EDU.openAchievement(
                        a.achievement_id
                      )
                }
              )
          )
        )
      );
    const studentsBlock =
      section(
        'students',
        'Студенты',
        students.length,
        h(
          'div',
          {
            class:
              'search3-students'
          },
          ...students.map(
            s =>
              h(
                'button',
                {
                  type: 'button',
                  class:
                    'search3-student',
                  onclick: () =>
                    EDU.show(
                      'review',
                      {
                        student: {
                          id:
                            s.student_id,
                          name:
                            EDU.shortName(
                              s.full_name
                            )
                        }
                      }
                    )
                },
                h(
                  'span',
                  {
                    class:
                      'search3-avatar'
                  },
                  EDU.initials(
                    s.full_name
                  )
                ),
                h(
                  'span',
                  {
                    class:
                      'search3-student-main'
                  },
                  h(
                    'strong',
                    {},
                    s.full_name
                  ),
                  h(
                    'small',
                    {},
                    [
                      s.group_name,
                      s.record_book_no
                        ? `зачётка ${s.record_book_no}`
                        : null
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  )
                ),
                h(
                  'span',
                  {
                    class:
                      'search3-student-status ' +
                      (
                        s.status ===
                        'expelled'
                          ? 'bad'
                          : ''
                      )
                  },
                  EDU.lbl(
                    'student_status',
                    s.status
                  )
                ),
                h(
                  'span',
                  {
                    class:
                      'search3-arrow',
                    'aria-hidden':
                      'true'
                  },
                  '→'
                )
              )
          )
        )
      );
    const eventsBlock =
      section(
        'events',
        'Мероприятия',
        events.length,
        h(
          'div',
          {
            class:
              'timeline search3-timeline'
          },
          ...events.map(
            e =>
              EDU.eventRow(e)
          )
        )
      );
    if (!total) {
      results.replaceChildren(
        h(
          'div',
          {
            class:
              'search3-empty'
          },
          h(
            'div',
            {
              class:
                'search3-empty-icon'
            },
            '⌕'
          ),
          h(
            'strong',
            {},
            'Ничего не найдено'
          ),
          h(
            'span',
            {},
            `По запросу «${q}» совпадений нет.`
          )
        )
      );
      return;
    }
    results.replaceChildren(
      h(
        'div',
        {
          class:
            'search3-summary'
        },
        h(
          'span',
          {},
          'Найдено'
        ),
        h(
          'strong',
          {},
          String(total)
        ),
        h(
          'small',
          {},
          'результатов'
        )
      ),
      achievementsBlock,
      studentsBlock,
      eventsBlock
    );
  }
});
