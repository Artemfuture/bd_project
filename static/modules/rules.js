EDU.registerModule('rules', {
  async render(host) {
    const { h } = EDU;
    const rules =
      await EDU.api('/rules');
    const today =
      EDU.isoToday();
    const any = (value, formatter) =>
      value
        ? formatter(value)
        : h(
            'span',
            {
              class:
                'rules3-any'
            },
            'любой'
          );
    const isArchived = (rule) =>
      rule.valid_to &&
      rule.valid_to < today;
    const activeRules =
      rules.filter(
        r => !isArchived(r)
      );
    const archivedRules =
      rules.filter(
        r => isArchived(r)
      );
    const categories =
      new Set(
        activeRules
          .map(r => r.category)
          .filter(Boolean)
      );
    const stats =
      h(
        'div',
        {
          class:
            'rules3-hero-stats'
        },
        h(
          'div',
          {
            class:
              'rules3-stat primary'
          },
          h(
            'span',
            {},
            'Активных правил'
          ),
          h(
            'strong',
            {},
            String(
              activeRules.length
            )
          )
        ),
        h(
          'div',
          {
            class:
              'rules3-stat'
          },
          h(
            'span',
            {},
            'Категорий'
          ),
          h(
            'strong',
            {},
            String(
              categories.size
            )
          )
        ),
        h(
          'div',
          {
            class:
              'rules3-stat'
          },
          h(
            'span',
            {},
            'В архиве'
          ),
          h(
            'strong',
            {},
            String(
              archivedRules.length
            )
          )
        )
      );
    const table =
      rules.length
        ? h(
            'div',
            {
              class:
                'rules3-table-wrap'
            },
            h(
              'table',
              {
                class:
                  'rules3-table'
              },
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h(
                    'th',
                    {},
                    'Вид'
                  ),
                  h(
                    'th',
                    {},
                    'Категория'
                  ),
                  h(
                    'th',
                    {},
                    'Уровень'
                  ),
                  h(
                    'th',
                    {},
                    'Роль'
                  ),
                  h(
                    'th',
                    {},
                    'Результат'
                  ),
                  h(
                    'th',
                    {},
                    'Период действия'
                  ),
                  h(
                    'th',
                    {
                      class:
                        'rules3-status-col'
                    },
                    'Статус'
                  ),
                  h(
                    'th',
                    {
                      class:
                        'rules3-points-col'
                    },
                    'Баллы'
                  )
                )
              ),
              h(
                'tbody',
                {},
                ...rules.map(
                  r => {
                    const archived =
                      isArchived(r);
                    return h(
                      'tr',
                      {
                        class:
                          archived
                            ? 'archived'
                            : ''
                      },
                      h(
                        'td',
                        {},
                        h(
                          'span',
                          {
                            class:
                              'rules3-kind'
                          },
                          EDU.lbl(
                            'kindShort',
                            r.kind
                          )
                        )
                      ),
                      h(
                        'td',
                        {
                          class:
                            'rules3-category'
                        },
                        EDU.lbl(
                          'category',
                          r.category
                        )
                      ),
                      h(
                        'td',
                        {},
                        any(
                          r.level,
                          v =>
                            EDU.lbl(
                              'level',
                              v
                            )
                        )
                      ),
                      h(
                        'td',
                        {},
                        any(
                          r.role,
                          v =>
                            EDU.lbl(
                              'role',
                              v
                            )
                        )
                      ),
                      h(
                        'td',
                        {},
                        any(
                          r.result,
                          v =>
                            EDU.lbl(
                              'result',
                              v
                            )
                        )
                      ),
                      h(
                        'td',
                        {
                          class:
                            'rules3-period'
                        },
                        h(
                          'span',
                          {},
                          EDU.fmtDate(
                            r.valid_from
                          )
                        ),
                        h(
                          'span',
                          {
                            class:
                              'rules3-period-arrow'
                          },
                          '→'
                        ),
                        h(
                          'span',
                          {},
                          r.valid_to
                            ? EDU.fmtDate(
                                r.valid_to
                              )
                            : 'сейчас'
                        )
                      ),
                      h(
                        'td',
                        {
                          class:
                            'rules3-status-col'
                        },
                        archived
                          ? h(
                              'span',
                              {
                                class:
                                  'rules3-status archived'
                              },
                              'Архив'
                            )
                          : h(
                              'span',
                              {
                                class:
                                  'rules3-status active'
                              },
                              'Действует'
                            )
                      ),
                      h(
                        'td',
                        {
                          class:
                            'rules3-points'
                        },
                        h(
                          'strong',
                          {},
                          EDU.pts(
                            r.points
                          )
                        )
                      )
                    );
                  }
                )
              )
            )
          )
        : h(
            'div',
            {
              class:
                'rules3-empty'
            },
            h(
              'strong',
              {},
              'Правил пока нет'
            ),
            h(
              'span',
              {},
              'Правила начисления баллов ещё не добавлены.'
            )
          );
    host.replaceChildren(
      h(
        'section',
        {
          class:
            'rules3-hero'
        },
        h(
          'div',
          {
            class:
              'rules3-hero-copy'
          },
          h(
            'span',
            {
              class:
                'rules3-kicker'
            },
            'Система оценки'
          ),
          h(
            'h1',
            {},
            'Правила начисления баллов'
          ),
          h(
            'p',
            {},
            'Для достижения применяется самое конкретное подходящее правило. Значение «любой» означает, что соответствующее условие не ограничивает применение правила.'
          )
        ),
        stats
      ),
      h(
        'div',
        {
          class:
            'rules3-note'
        },
        h(
          'span',
          {
            class:
              'rules3-note-icon'
          },
          'i'
        ),
        h(
          'div',
          {},
          h(
            'strong',
            {},
            'Как читать таблицу'
          ),
          h(
            'span',
            {},
            'Архивные правила больше не применяются к новым достижениям, но остаются в списке для истории начислений.'
          )
        )
      ),
      h(
        'section',
        {
          class:
            'rules3-panel'
        },
        h(
          'div',
          {
            class:
              'rules3-panel-head'
          },
          h(
            'div',
            {},
            h(
              'span',
              {
                class:
                  'rules3-eyebrow'
              },
              'Справочник'
            ),
            h(
              'h2',
              {},
              'Действующие и архивные правила'
            )
          ),
          h(
            'span',
            {
              class:
                'rules3-count'
            },
            `Всего: ${rules.length}`
          )
        ),
        table
      )
    );
  }
});
