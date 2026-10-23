EDU.registerModule('achievements', {
  async render(host) {
    const { h } = EDU;
    const tabs = [
      ['', 'Все'],
      ['draft', 'Черновики'],
      ['under review', 'На проверке'],
      ['confirmed', 'Подтверждено'],
      ['rejected', 'Отклонено']
    ];
    let active = '';
    let all = [];
    const totalPoints = h(
      'strong',
      { class: 'ach3-points-value' },
      '0'
    );
    const totalCount = h(
      'strong',
      {},
      '0'
    );
    const confirmedCount = h(
      'strong',
      {},
      '0'
    );
    const reviewCount = h(
      'strong',
      {},
      '0'
    );
    const rejectedCount = h(
      'strong',
      {},
      '0'
    );
    const filters = h(
      'div',
      { class: 'ach3-filters' }
    );
    const body = h(
      'div',
      { class: 'ach3-body' },
      EDU.skeleton(4)
    );
    const reload = async () => {
      all = await EDU.api('/achievements/mine');
      draw();
    };
    function draw() {
      const count = (status) =>
        status
          ? all.filter(a => a.status === status).length
          : all.length;
      const confirmedPoints = all
        .filter(a => a.status === 'confirmed')
        .reduce(
          (sum, a) =>
            sum + Number(a.points || 0),
          0
        );
      totalPoints.textContent =
        EDU.pts(confirmedPoints);
      totalCount.textContent =
        count('');
      confirmedCount.textContent =
        count('confirmed');
      reviewCount.textContent =
        count('under review');
      rejectedCount.textContent =
        count('rejected');
      filters.replaceChildren(
        ...tabs.map(([status, title]) => {
          const isActive =
            status === active;
          return h(
            'button',
            {
              type: 'button',
              class:
                'ach3-filter ' +
                (isActive ? 'active' : ''),
              onclick: () => {
                active = status;
                draw();
              }
            },
            h(
              'span',
              {},
              title
            ),
            h(
              'b',
              {},
              count(status)
            )
          );
        })
      );
      const shown =
        all.filter(
          a =>
            !active ||
            a.status === active
        );
      body.replaceChildren(
        shown.length
          ? h(
              'div',
              {
                class:
                  'timeline ach3-timeline'
              },
              ...shown.map(a =>
                EDU.achRow(
                  a,
                  {
                    onclick: () =>
                      EDU.openAchievement(
                        a.achievement_id,
                        reload
                      )
                  }
                )
              )
            )
          : h(
              'div',
              {
                class:
                  'ach3-empty'
              },
              h(
                'strong',
                {},
                all.length
                  ? 'Здесь пока пусто'
                  : 'Достижений пока нет'
              ),
              h(
                'span',
                {},
                all.length
                  ? 'В выбранном статусе достижений нет.'
                  : 'Добавить первое достижение можно кнопкой в левом меню.'
              )
            )
      );
    }
    host.replaceChildren(
      h(
        'section',
        {
          class:
            'ach3-hero'
        },
        h(
          'div',
          {
            class:
              'ach3-hero-copy'
          },
          h(
            'span',
            {
              class:
                'ach3-kicker'
            },
            'Портфолио'
          ),
          h(
            'h1',
            {},
            'Мои достижения'
          ),
          h(
            'p',
            {},
            'Ваши заявки, результаты проверки и начисленные баллы.'
          )
        ),
        h(
          'div',
          {
            class:
              'ach3-points'
          },
          h(
            'span',
            {},
            'Подтверждено баллов'
          ),
          totalPoints
        )
      ),
      h(
        'section',
        {
          class:
            'ach3-summary'
        },
        h(
          'div',
          {
            class:
              'ach3-summary-item'
          },
          h(
            'span',
            {},
            'Всего'
          ),
          totalCount
        ),
        h(
          'div',
          {
            class:
              'ach3-summary-item confirmed'
          },
          h(
            'span',
            {},
            'Подтверждено'
          ),
          confirmedCount
        ),
        h(
          'div',
          {
            class:
              'ach3-summary-item review'
          },
          h(
            'span',
            {},
            'На проверке'
          ),
          reviewCount
        ),
        h(
          'div',
          {
            class:
              'ach3-summary-item rejected'
          },
          h(
            'span',
            {},
            'Отклонено'
          ),
          rejectedCount
        )
      ),
      h(
        'section',
        {
          class:
            'ach3-panel'
        },
        h(
          'div',
          {
            class:
              'ach3-toolbar'
          },
          h(
            'div',
            {
              class:
                'ach3-toolbar-title'
            },
            h(
              'span',
              {
                class:
                  'ach3-eyebrow'
              },
              'Список'
            ),
            h(
              'h2',
              {},
              'Все достижения'
            )
          ),
          filters
        ),
        body
      )
    );
    await reload();
  }
});
