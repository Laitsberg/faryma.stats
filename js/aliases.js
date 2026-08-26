/* ============================================================
   ОДНА ВСЕЛЕННАЯ — ОДНО НАЗВАНИЕ
   ------------------------------------------------------------
   Один и тот же тайтл в таблице пишут по-разному: по-английски и
   ромадзи, с переводом и без, «86» и «86 Eighty-Six». Для сайта это
   разные вселенные: две карточки, два места в списке, разнесённые
   опенинги врозь.

   Здесь список: слева — как написано в таблице, справа — как
   показывать. Правьте смело, это обычный список, а не код.
   Правило, по которому выбиралась правая часть: то написание,
   которое чаще встречается в самой таблице. Если поровну — то,
   под которым остальные сезоны собираются в одну франшизу.

   Чего здесь нет намеренно: разные вещи с похожими именами.
   «Dragon Ball Z» и «Dragon Ball Z: Resurrection 'F'» — сериал и
   полнометражка, «Psycho-Pass» и «Psycho-Pass: The Movie» — тоже.
   Их сводить нельзя, даже если каталог опенингов их перепутал.
   ============================================================ */

const SOURCE_ALIAS = {
  /* --- перевод названия на русский --- */
  'Re:Zero. Жизнь с нуля в альтернативном мире': 'Re:Zero - Starting Life in Another World',
  'Re:Zero - Жизнь с нуля в альтернативном мире': 'Re:Zero - Starting Life in Another World',
  'Дневник будущего':      'Mirai Nikki',
  'Школа мертвецов':       'Highschool of the Dead',
  'Дандадан':              'Dandadan',
  'Волейбол!!':            'Haikyu!!',
  'Когда плачут цикады':   'Higurashi no naku koro ni',
  'Джорно Джованны; Невероятное приключение ДжоДжо: Золотой ветер':
                           "JoJo's Bizarre Adventure: Golden Wind",
  'Невероятное приключение ДжоДжо: Несокрушимый алмаз':
                           "JoJo's Bizarre Adventure: Diamond Is Unbreakable",
  'Евангелион нового поколения: Конец Евангелиона':
                           'Neon Genesis Evangelion: The End of Evangelion',

  /* --- английское название против ромадзи --- */
  'Attack on Titan Season 2':          'Shingeki no Kyojin Season 2',
  'Attack on Titan Season 3':          'Shingeki no Kyojin Season 3',
  'Attack on Titan S4':                'Shingeki no Kyojin: The Final Season',
  'Shingeki no kyojin: Attack on Titan': 'Shingeki no Kyojin',
  'My Hero Academia Season 6':         'Boku no Hero Academia 6th Season',
  'Seraph of the End: Vampire Reign':  'Owari no Seraph',
  'Kekkai Sensen':                     'Blood Blockade Battlefront',
  'Arslan Senki TV':                   'The Heroic Legend of Arslan',
  'Destiny of the Shrine Maiden':      'Kannazuki no Miko',
  'Chi.: Chikyuu no Undou ni Tsuite':  'Orb: On the Movements of the Earth',
  'Samurai X':                         'Rurouni Kenshin',
  'Higurashi: When They Cry':          'Higurashi no naku koro ni',
  'Higurashi: When They Cry – Gou':    'Higurashi no Naku Koro ni Gou',
  'Higurashi no Naku Koro ni 2nd Series': 'Higurashi no Naku Koro ni Kai',
  'Umineko: When They Cry':            'Umineko No Naku Koro Ni',
  'Made in Abyss: The Golden City of the Scorching Sun': 'Made in Abyss Season 2',
  'Kaguya-sama: Love Is War -Ultra Romantic-': 'Kaguya-sama: Love is War 3rd Season',
  'MASHLE: MAGIC AND MUSCLES Season 2': 'Mashle 2nd Season',
  'Digimon Universe App Monsters':     'Digimon Universe: Appli Monsters',
  'Gundam: Iron-Blooded Orphans':      'Mobile Suit Gundam: Iron-Blooded Orphans',

  /* --- короткое имя против полного --- */
  'Evangelion':                        'Neon Genesis Evangelion',
  'Евангелион':                        'Neon Genesis Evangelion',
  'Evangelion 3.0':                    'Evangelion: 3.0 You Can (Not) Redo',
  'Rebuild of Evangelion: 2.0 You Can (Not)': 'Evangelion: 2.0 You Can (Not) Advance',
  'Billion x School, 2024':            'Billion x School',
  'Billion x School (2024)':           'Billion x School',
  '86 Eighty-Six':                     '86',
  'Ninja Slayer From Animation':       'Ninja Slayer',
  'Tengen Toppa Gurren Lagann':        'Gurren Lagann',
  'Tengen Toppa Gurren-Lagann':        'Gurren Lagann',
  'Initial D First Stage':             'Initial D',
  "Jojo's Bizarre Adventure - Phantom Blood": "JoJo's Bizarre Adventure",
  'Genshin Impact 4.6':                'Genshin Impact',

  /* --- одно название, разное написание --- */
  'Wolf’s Rain':                       "Wolf's Rain",
  'Hunter x Hunter (2011)':            'Hunter x Hunter 2011',
  'Berserk (2016)':                    'Berserk 2016',
  'Chainsaw Man the Movie: Reze Arc':  'Chainsaw Man – The Movie: Reze Arc',
  "Rock Is a Lady's Modest":           "Rock Is a Lady's Modesty",
  'Oshi no Ko Season 2':               "'Oshi no Ko' 2nd Season",
  '2nd Season Jujutsu Kaisen':         'Jujutsu Kaisen 2nd Season',
  'Re:Zero - Starting Life in Another World Season 2 Part 2':
                                       'Re:Zero - Starting Life in Another World 2nd Season Part 2',
  // так сезоны встают под общую франшизу «Haikyu!!»
  'Haikyuu!! Second Season':           'Haikyu!! 2nd Season',
  'Haikyu!! Second Season':            'Haikyu!! 2nd Season'
};
