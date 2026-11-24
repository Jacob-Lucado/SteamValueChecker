-- Community Furni also lists each furni by what it is, next to its set page.

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001001, 1850000000, 'Bed', 176, NULL, 1, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001001, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Bed_1','Atlanta_Japandi_Bed_4','Atlanta_Japandi_Bed_5','Atlanta_Japandi_Hammock','adobe_bed_two','bed_armas_saw','hive_22_dark_timber_single_bed','hive_22_light_timber_single_bed','kasja_s_bed','monsterseyes_c17_bed');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001002, 1850000000, 'Chair', 176, NULL, 2, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001002, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Bar_Stool','Atlanta_Japandi_Bench_1','Atlanta_Japandi_Bench_2','Atlanta_Japandi_Chair_1','Atlanta_Japandi_Chair_2','Atlanta_Japandi_Chair_3','Atlanta_Japandi_Chair_4','Atlanta_Japandi_Pillow_1','Atlanta_Japandi_Pillow_3','Atlanta_Japandi_Rattan_Chair','Atlanta_scandi_bench','Atlanta_scandi_bench_2','Atlanta_scandi_chair','Atlanta_scandi_chair_2','Atlanta_scandi_couch','BW_HogwartsBenchGH','BW_TrainSofa','BlackAquaPillow','BlackBluePillow','BlackCherryPillow','BlackMangoPillow','BlackMauvePillow','BlackSilverPillow','CandyCottonPillow','GrimmauldChair','GrimmauldSofa','Haaziq_couch','Haaziq_pouf','Royal_throne_Atlanta','TimeturnerVersaillesChair','acnl_gorgeous_chair','acnl_gorgeous_sofa','acnl_gorgeous_stool','adobe_chair_wood','anc16_sofa','bois_hbct_chair','cstm_j21_bubblejuice_pillow','cstm_j21_grunge_couch','cstm_j21_grunge_pillow','cstm_j21_grunge_pillow2','cstm_j21_grunge_stool','cstm_j21_india_pillow','cuer_h17_sofa','drinky_23_chair_01','drinky_23_chair_01_01','drinky_23_pillow_01','drinky_23_sofa_01','drinky_23_stool_01','dukpub_chair','durm_bench','durmstrang_chairBW','fancy16_seat1','habbox_haaziq_armchair','habbox_haaziq_bean_bag','habbox_haaziq_couch','habbox_haaziq_sofa','habbox_haaziq_wooden_stool','hive_22_dark_timber_chair','hive_22_dark_timber_sofa','hive_22_light_timber_chair','hive_22_light_timber_sofa','hive_23_bear_sofa','hive_23_dia_throne','hive_23_hc0_sofa','hive_23_massiva_chair','hive_23_netc_chair','hive_23_reception_chair','hive_23_reception_sofa','hive_hc1_chair1','hive_hc1_chair2','hive_hc1_stool1','hive_hc1_stool2','hive_hc3_pillow','hton_22_lby_sofa','hton_22_throne','hween_c16_chair3','hween_c16_chair4','kasja_c_sofa','kasja_s_bench','kasja_s_bench1','kasja_s_chair','kasja_s_chair1','kasja_s_chair2','kasja_s_pillow','kasja_s_sofa','kasja_s_stool','kasja_s_stool1','l_ml_chair','l_ml_sofa','lush_wl18_chair_g','lush_wl18_chair_y','lush_wl18_stool','modern_c18_sofa','monsterseyes_c17_armchair','monsterseyes_c17_sofa','monsterseyes_c17_sofa1','plta_h17_sofa','pub17_c15_chair_g','roof_sofa','rooftop17_sofa','room_roof15_sofa1','sakuraaa_throne','sc_td_chair','sc_td_sofa','shadow_lostmonkey_armchair','sll_chair','sll_sofa','sofa_h17_aamm','sun_chair1','tab_chair_bnjwt','vBlackPillow');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001003, 1850000000, 'Clothing & misc props', 176, NULL, 3, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001003, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Apo_Grec_Bouclier','Atlanta_Japandi_Statue','asth_estatue','cstm_j21_big_shield','cstm_j21_sword_shield','habbox_haaziq_shop_bag','habbox_shone_mini_statue','hive_23_panda_bag1','hive_23_panda_bag2','hive_hc3_elephant_statue','potterStatue');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001004, 1850000000, 'Electronics', 176, NULL, 4, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001004, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_scandi_computer','Atlanta_scandi_tv','Cola_Machine_Candy','TimeturnerKingsPiano','TimeturnerQueensPiano','Yvess5_McDo_MachineBoisson','Yvess5_McDo_MachineCremeGlace','bop_blue_hologram','bop_green_hologram','bop_indigo_hologram','bop_orange_hologram','bop_purple_hologram','bop_red_hologram','bop_violet_hologram','drinky_23_coffee_machine_01','drinky_23_tv_01','habmn_radio','hive_23_hc0_arcade_cab','hive_23_netc_computer','hive_23_wood_speaker','hive_hc3_wooden_screen','hp_screen','radio_antigua','shadow_lostmonkey_drum','shadow_lostmonkey_tv');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001005, 1850000000, 'Food & drink', 176, NULL, 5, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001005, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Fridge_1','Atlanta_Japandi_Smeg_Fridge','GrimmauldStove','HMsubway_drink','Haaziq_drink','Royal_icecream_Atlanta','adobe_bottle','adobe_fridge','adobe_sink_01','bitos_corva_sink','cake_fruitsrouge','cstm_j21_big_cake','cstm_j21_cinema_food','cstm_j21_donut','drinky_23_coffee_product_01_01','drinky_23_coffee_products_01','drinky_23_cup_01','drinky_23_kitchen_island_01','drinky_23_kitchen_island_01_01','drinky_23_sink_01','drinky_23_sink_01_01','habbox_haaziq_cocktail','habbox_haaziq_cup','habbox_haaziq_sink','hive_22_dark_timber_fridge','hive_hc3_icecream','hogwarts_cup','hp_bottle','hp_candy','kasja_c_cake','kitchen19_deco1','kitchen19_deco2','kitchen19_deco3','kitchen19_divdr','kitchen19_divdr2','kitchen19_food','kitchen19_sink','kitchen19_stove','kitchen_stove','ktchn11_sink','lush17_cup','sakurapink_icecream','sc_td_candy','shadow_lostmonkey_bottle','wedding_cake');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001006, 1850000000, 'Holiday & seasonal', 176, NULL, 6, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001006, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Egg','Royal_egg_Atlanta','armario_hogwarts','blackBoard_hp','bw_snow','calderoniHP','cstm_j21_halloween_garland','cstm_j21_halloween_ghost','cstm_j21_halloween_katana','cstm_j21_halloween_masks','cstm_j21_halloween_octopus','cstm_j21_halloween_puppet','cstm_j21_halloween_rice','cstm_j21_skull','cstm_j21_snowman','dada_book_Hp','easter_h17_carta','easter_h17_macet','easter_h17_maqui','easter_h17_teter','erbologia_HP','finestreTanaHP','gift_mdlcar1','gift_mdlcar2','habboween_gras1','habboween_gras2','habbox_shone_livre_skull','hogwarts_broom','hogwarts_candelebw','hogwarts_chairbw','hogwarts_fenix','hogwarts_oesed','hogwarts_quidditch','hogwarts_snitch','hp_acromantula','hp_alchemybook','hp_angel','hp_architect','hp_azkaball','hp_base','hp_bats','hp_bigcage','hp_bigchair','hp_bigstones','hp_bigtorch','hp_blood','hp_bludger','hp_bluebox','hp_bluecracker','hp_bluewater','hp_boggart1','hp_boggart2','hp_bookstack','hp_bookstack2','hp_bookz','hp_brains','hp_bucket','hp_butterbeer','hp_carriage','hp_castleroof','hp_cat','hp_centaur1','hp_centaur2','hp_chimera1','hp_chimera2','hp_choptree','hp_clouds','hp_crystalball','hp_cylinder','hp_dhpainting','hp_divstool1','hp_divtable1','hp_doorarch','hp_dum','hp_firework1','hp_firework2','hp_flask','hp_flowers','hp_fountainwater','hp_freakywater','hp_gellert','hp_glass','hp_glasslamp','hp_globe','hp_goblet','hp_goth','hp_granite','hp_greenbox','hp_gryff','hp_hallway1','hp_hallway2','hp_heads','hp_herbology','hp_highstone','hp_hippogriff','hp_historybook','hp_hydra1','hp_hydra2','hp_jokebox','hp_kettle','hp_key','hp_knight','hp_landscape','hp_lanterns','hp_lineblock','hp_lockhart','hp_londonblock','hp_lowstone','hp_macusa','hp_mailbox','hp_mailboz','hp_mask','hp_mermaid','hp_ministryblock','hp_minotaur1','hp_minotaur2','hp_necroot','hp_oillamp','hp_oldpainting','hp_parchment','hp_phoenix1','hp_pipe','hp_pokertafel','hp_pots','hp_puffskein1','hp_puffskein2','hp_puffskein3','hp_puffskein4','hp_pumpkin','hp_purplebox','hp_purplecracker','hp_quaffle','hp_quaffleball','hp_quidchest','hp_quidditchring','hp_quill1','hp_quill2','hp_quill3','hp_quill4','hp_ravenclaw','hp_redbox','hp_redcracker','hp_rocks','hp_roots','hp_ruin','hp_runeblock1','hp_runeblock2','hp_sack','hp_scabberscup','hp_scrolls','hp_scrollstack','hp_skelegro','hp_skeleton','hp_skull','hp_slughorn','hp_slytherin','hp_smallchest','hp_smallwindow','hp_smallwindoww','hp_spade','hp_spectre','hp_spider','hp_statue1','hp_statue2','hp_stonechest','hp_telescope','hp_trophy','hp_umbrella','hp_unicorn','hp_vensterbank','hp_vensterbankw','hp_weasleyclock','hp_weasleyshop','hp_wedgeblock','hp_wheel','hp_wideblock','hp_windowpiece1','hp_windowpiece1w','hp_windowpiece2','hp_windowpiece2w','hp_windowpiece3','hp_windowpiece3w','hp_yellowbox','hp_yellowcracker','icm_easter','kasja_c_present','kasja_c_present1','monsterseyes_pumpkin','monsterseyes_pumpkin2','monsterseyes_pumpkin3','monsterseyes_pumpkin4','pilar_hogwarts','port_h17_hogwarts','storiaBookHp','tavDivinazHp','telescopioHp','xmas11_elewoo1','xmas11_elewoo2','xmas11_elewoo3','xmas11_elewoo4','xmas11_elewoo5','xmas11_elewoo6','xmas11_elewoo7','xmas13_floo1','xmas13_floo2');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001007, 1850000000, 'Lighting', 176, NULL, 7, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001007, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Candle','Atlanta_Japandi_Lamp_1','Atlanta_Japandi_Lamp_2','Atlanta_scandi_lamp','Atlanta_scandi_lamp_2','DIY_a028_LuckyLantern','HM_goth_chandelier','HMold_lamp','TimeturnerChandelier1','TimeturnerChandelier2','TimeturnerChandelier3','TimeturnerChandelier4','TimeturnerGoldenCandle','TimeturnerGoldenCandle2','bazaar_c20_lamp','chandelier_gaz','chandelier_yvess1','cstm_j21_bubblejuice_lamp','cstm_j21_bubblejuice_lamp2','cstm_j21_halloween_lantern','cstm_j21_lantern','durmstrang_fireplaceBW','eglise_chandelier','gryffindorTorch','habbox_haaziq_cube_lamp','habbox_haaziq_fireplace1','habbox_haaziq_fireplace2','habbox_haaziq_lamp_1','habbox_haaziq_lamp_2','habbox_haaziq_lamp_3','habbox_haaziq_lamp_4','habbox_haaziq_lamp_5','hive_22_dark_timber_lamp','hive_22_light_timber_block','hive_22_light_timber_fridge','hive_22_light_timber_lamp','hive_hc1_fireplace','hive_hc3_beehive_bulb','hp_chandelier','hp_fire1','hp_fire2','hp_lantern','hp_torch','hufflepuffTorch','kasja_s_lamp','lamp_2','light03_chande','light03_floors','lush_wl18_lamp','lush_wl18_lamp_g','lush_wl18_lamp_y','monsterseyes_c17_light','ravenclawTorch','slytherinTorch');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001008, 1850000000, 'Plants & nature', 176, NULL, 8, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001008, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Palm_Tree','Atlanta_Japandi_Plant_1','Atlanta_Japandi_Plant_10','Atlanta_Japandi_Plant_11','Atlanta_Japandi_Plant_12','Atlanta_Japandi_Plant_13','Atlanta_Japandi_Plant_14','Atlanta_Japandi_Plant_2','Atlanta_Japandi_Plant_3','Atlanta_Japandi_Plant_4','Atlanta_Japandi_Plant_5','Atlanta_Japandi_Plant_6','Atlanta_Japandi_Plant_7','Atlanta_Japandi_Plant_8','Atlanta_Japandi_Plant_9','Atlanta_Japandi_Pond','Atlanta_Japandi_Pot_1','Atlanta_Japandi_Pot_2','Atlanta_Japandi_Rock','Atlanta_Japandi_Stone_Block_1','Atlanta_Japandi_Stone_Block_2','Atlanta_Japandi_Stone_Block_3','Atlanta_Japandi_Stone_Wall','Atlanta_Japandi_Tree_1','Atlanta_Japandi_Tree_2','Atlanta_Japandi_Water','Atlanta_Japandi_Wood_Log','Atlanta_scandi_hanging_plant','Atlanta_scandi_plant','Atlanta_scandi_plant_2','BW_MinisFountain','City_cactus','DIY_a035_CeladonVase','Decoratie_Pot','GRUDGE_city_plante','Klein_cactus','Sierlijke_Plant','Stone_BloccoBW','TimeturnerBeigeRoundStone2','TimeturnerBeigeStoneWall','TimeturnerGoldRoundStone2','TimeturnerHedge','TimeturnerRoundStone1','TimeturnerStoneAngels','TimeturnerStoneWall','TimeturnerTree','Yvess5_Liane3','acacia_amarilla','bitos_corva_flower2','bitos_corva_flower3','bitos_corva_flower4','bitos_corva_flower5','bling11_plant2','cactus_couleur','cstm_j21_coffee_pot','cstm_j21_flower','cstm_j21_flower_basket','cstm_j21_grey_stone','cstm_j21_halloween_plant','cstm_j21_stone_edge','cstm_j21_water_edge','dino_c15_tree6','dino_c15_tree7','drinky_23_plant_01','drinky_23_plant_01_01','drinky_23_plant_divider_01','drinky_23_plant_divider_01_01','easter_h17_plant','eglise_plante','habbox_haaziq_plante','habbox_haaziq_plante_10','habbox_haaziq_plante_2','habbox_haaziq_plante_3','habbox_haaziq_plante_4','habbox_haaziq_plante_5','habbox_haaziq_plante_6','habbox_haaziq_plante_7','habbox_haaziq_plante_8','habbox_haaziq_plante_9','habbox_haaziq_pot_fleurs_1','habbox_haaziq_pot_fleurs_2','habbox_haaziq_vase','habbox_haaziq_vase2','habbox_haaziq_vase3','habbox_haaziq_vase_mini','habbox_shone_mini_plante_1','habbox_shone_mini_plante_2','habbox_shone_vase_blanc_1','habbox_shone_vase_blanc_2','habbox_shone_vase_bleu','habbox_shone_vase_bronze_1','habbox_shone_vase_bronze_2','habbox_shone_vase_gris_1','habbox_shone_vase_gris_2','habbox_shone_vase_orange','habbox_shone_vase_rouge','habbox_shone_vase_violet','hc16_fountain','hc16_pineapple_tree','hc16_wellness_plant','hive_23_netc_plant1','hive_23_netc_plant2','hive_hc3_fountain','hp_plant1','hp_plant2','hp_pot','hp_rock1','hp_rock2','hp_rock3','hp_rock4','hp_water','kasja_s_plant','kasja_v_tree','kfchn10_pot','kitchen19_plant','kitchen19_plant2','lm_plant1','lush_wl18_planter','modr_plant','nature18_spar_arbuste','nature18_spar_bosquet7','nature18_spar_bosquet77','nature18_spar_brindilles','nature18_spar_feuilles1','nature18_spar_feuilles2','nature18_spar_fleursbleues','nature18_spar_fleursrouges','nature18_spar_haie7','nature18_spar_haie77','nature18_spar_herbe7','nature18_spar_herbe77','nature18_spar_oiseau','nature18_spar_roses','nature18_spar_terre','nature18_spar_tronc','plant_c15_tee','plant_lianen1','plant_lianen2','plante','plante3_frogg','pot_cafe','pot_peinture','rock_column_bw','sc_td_plant','stone_fountain','vase','vase_plante_frogg','yvess5_decors_liane1','yvess5_decors_liane2');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001009, 1850000000, 'Rugs & floors', 176, NULL, 9, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001009, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Apo_Grec_Dalle1','Apo_Grec_Dalle2','Apo_Grec_Dalle3','Atlanta_Japandi_Carpet','Atlanta_Japandi_Floor_Concrete','Atlanta_Japandi_Rattan_Floor','Atlanta_Japandi_Rug','Atlanta_Japandi_Stone_Floor','Atlanta_Japandi_Wood_Floor','Atlanta_Scandi_Wood_Floor','Atlanta_scandi_Carpet','Atlanta_scandi_concrete_floor','BW_Path','BW_PathCorner','BwStairsFloor','GrimmauldFloor','Haaziq_concrete_floor','Haaziq_rug_1','Haaziq_rug_2','Haaziq_rug_white_tiger','Ja_dalleflech','Or_dalleflech','TimeturnerStoneFloor1','TimeturnerWoodenFloor','TimeturnerWoodenFloor2','bl_dalleflech','bl_dallering','brick04_floor_I','cstm_j21_attic_carpet','cstm_j21_grass_edge','cstm_j21_rug','dalle_pierre_apo','drinky_23_floor_01','drinky_23_floor_01_01','drinky_23_floor_02_01','fairy_grass','grassElevatorBw','habbox_haaziq_black_floor','habbox_haaziq_stone_floor','hive_23_jupiter_rug','hive_23_massiva_floor','hive_23_uranus_rug','hogwartsFloor','hogwarts_floor2','hp_floor1','hp_floor2','hp_tile','ja_dallering','kasja_s_rug','kasja_s_rug1','kasja_v_tile','monsterseyes_c17_carpet','monsterseyes_c17_floor','or_dallering','po_grass_1','rg_dalleflech','rg_dallering','ro_dalleflech','ro_dallering','sand_path','skull04_floor_I','tile_stackmagic3','ve_dalleflech','ve_dallering');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001010, 1850000000, 'Shelves & storage', 176, NULL, 10, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001010, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Clothing_Rack','Atlanta_Japandi_Crate','Atlanta_Japandi_Shelf','Atlanta_scandi_dresser','GrimmauldCabinet','Yvess5_Garage_GrosCoffre','cstm_j21_box','drinky_23_cabinet_01','drinky_23_cabinet_02_01','drinky_23_display_01','drinky_23_shelf_01','drinky_23_shelf_01_01','eglise_coffre','habbox_haaziq_club_shelves','habbox_haaziq_shoes_box','habbox_haaziq_wood_box','hc15_club_display','hive_23_chest_dice','hive_hc1_dresser','hive_hc3_box','hp_bookcase','hp_box','hp_chest','hp_closet','kasja_s_cupboard','kasja_s_dresser','kitchen_cabinet','library17_shelves10','library17_shelves6','library17_shelves8');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001011, 1850000000, 'Sports & games', 176, NULL, 11, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001011, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Basket_1','Atlanta_Japandi_Basket_2','Atlanta_Japandi_Basket_3','Atlanta_Japandi_Basket_4','Atlanta_Japandi_Pool_1','Atlanta_Japandi_Pool_2','BW_QuidditchRing','affaires_sport','bal_nequam','bowling_baan','bowling_bal1','bowling_bal2','bowling_bal3','bowling_bal4','bowling_bal5','bowling_bal6','bowling_kegel','cstm_j21_dice','cstm_j21_ring','cstm_j21_small_trophy','gants_boxe','hive_chess_tbl','hton_22_gemDice','hton_22_smokeDice');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001012, 1850000000, 'Table', 176, NULL, 12, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001012, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Apo_Grec_Table','Atlanta_Japandi_Table_1','Atlanta_Japandi_Table_2','Atlanta_Japandi_Table_3','Atlanta_Japandi_Table_4','Atlanta_Japandi_Table_5','Atlanta_Japandi_Table_6','Atlanta_Japandi_Table_7','Atlanta_Japandi_Table_8','Atlanta_scandi_nightstand','BW_HogwartsTableGH','GRUDGE_city_table','Haaziq_coffee_table','Haaziq_side_table','TimeturnerTeaTable','Yvess5_McDo_Table','adobe_desk_01','adobe_desk_02','adobe_desk_03','adobe_desk_04','cstm_j21_grunge_table1','cstm_j21_grunge_table2','cstm_j21_grunge_table3','drinky_23_counter_01','drinky_23_counter_01_01','drinky_23_counter_02_01','drinky_23_counter_03_01','drinky_23_counter_top_01','drinky_23_counter_top_01_01','drinky_23_counter_top_02_01','drinky_23_counter_top_03_01','drinky_23_counter_top_04_01','drinky_23_counter_top_05_01','drinky_23_table_01','drinky_23_table_01_01','drinky_23_table_02_01','drinky_23_table_03_01','drinky_23_table_top_01','drinky_23_table_top_01_01','drinky_23_table_top_02_01','drinky_23_table_top_03_01','duckpub1_desk','duckpub1_table2','duckpub2_desk','eglise_table','eric18_spar_bar','eric18_spar_table','globe_bar','habbox_alaska_arosa_table1','habbox_alaska_arosa_table2','habbox_haaziq_coffee_table','habbox_haaziq_coffee_table2','habbox_haaziq_coffee_table3','habbox_haaziq_coffee_table4','habbox_haaziq_table_1','habbox_haaziq_table_10','habbox_haaziq_table_11','habbox_haaziq_table_12','habbox_haaziq_table_13','habbox_haaziq_table_2','habbox_haaziq_table_3','habbox_haaziq_table_4','habbox_haaziq_table_5','habbox_haaziq_table_6','habbox_haaziq_table_7','habbox_haaziq_table_8','habbox_haaziq_table_9','habbox_moderne_shone_table_b','habbox_moderne_shone_table_n','habbox_shone_console1','habbox_shone_console2','hive_22_dark_timber_nightstand','hive_22_dark_timber_table','hive_22_light_timber_nightstand','hive_22_light_timber_table','hive_23_hc0_table','hive_23_massiva_table1','hive_23_massiva_table2','hive_23_netc_counter','hive_23_netc_desk','hive_23_table2','hive_hc1_table','hton_22_lby_counter','kasja_s_table','l_ml_table','lush_wl18_table','maff_table1','modern_bar','modr_desk','monsterseyes_c17_table','potionsTable','roof_table','shadow_lostmonkey_table','sll_table','sun_table1','table_plakfc_round','vikipub_table_r','wedding_table');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001013, 1850000000, 'Toys & plush', 176, NULL, 13, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001013, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('City_Fish','Royal_dragon_Atlanta','baby_bal','baby_blokjes','baby_speelgoed1','baby_speelvloer','baby_wieg_jongen','baby_wieg_meisje','bitos_corva_bear','blue_unicorn','cagee01_dragon','cstm_j21_dragon_statue','cstm_j21_penguin','hbox_bear','hcity_peluche3D','hive_23_dia_dragon','hive_23_encrusted_dragon','hive_23_encrusted_dragon_crack','hogwart_buho','hosptl_baby','kitty_dragon_blk_kyat','monsterseyes_c17_cat','owl_Lectern_bw','pink_unicorn');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001014, 1850000000, 'Wall decoration', 176, NULL, 14, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001014, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Clock','Atlanta_Japandi_Frame','Atlanta_Japandi_Mirror_Big','Atlanta_Japandi_Mirror_Small','Atlanta_Japandi_Painting','Atlanta_Japandi_Sign','Atlanta_Japandi_Wood_Frame','Atlanta_scandi_painting','Atlanta_scandi_painting_2','PosterMinisteroBW','TimeturnerClock','TimeturnerFlowerWallpaper','TimeturnerMirror','adobe_b_poster','ads_mpu_banner','asth_painting1','asth_painting2','cstm_j21_attic_clock','cstm_j21_attic_painting','cstm_j21_halloween_mirror','cstm_j21_wanted_poster','drinky_23_painting_01','habbox_shone_appareil_photo','habbox_shone_poster_mur','hcity_poster1','hive_makeup_mirror','hivewood_mirror','hp_frame','hp_painting1','hp_painting2','hp_painting3','hp_painting4','hp_painting5','hp_painting6','hp_sign','kasja_s_painting','kasja_s_wallart','orientl_poster','poster_calendrier','tableau_seyra1','tableau_seyra2','tableau_seyra3');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001015, 1850000000, 'Walls & pillars', 176, NULL, 15, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001015, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Beam_1','Atlanta_Japandi_Beam_2','Atlanta_Japandi_Beam_3','Atlanta_Japandi_Beam_5','Atlanta_Japandi_Fence_1','Atlanta_Japandi_Fence_2','Atlanta_Japandi_Fence_3','Atlanta_Japandi_Kitchen_Block','Atlanta_Japandi_Roof_1','Atlanta_Japandi_Roof_2','Atlanta_Japandi_Roof_3','Atlanta_Japandi_Roof_4','Atlanta_Japandi_Roof_5','Atlanta_Japandi_Roof_6','Atlanta_Japandi_Stairs','Atlanta_Japandi_Wall_1','Atlanta_Japandi_Wood_Block','Atlanta_Scandi_Wood_Wall','Atlanta_Scandi_Wood_Wall_2','Atlanta_scandi_block','Atlanta_scandi_ladder','Atlanta_scandi_ladder_2','Atlanta_scandi_pillar','Atlanta_scandi_stairs','BW_BrownRoof','BW_BrownRoofCorner','BW_BrownRoofCornerH','BW_BrownRoofDec','BW_BrownRoofH','BW_DiagonWall','BW_GoldenRoof','BW_MarbleStairs','BW_QuidditchWall','BW_VictorianBlock','BewitchedStair','Durm_pillar','GrimmauldWall','LC_block_bout','LC_block_exec','Royal_pillar_Atlanta','StageFence','TimeturnerBeigeOrnamentBlock','TimeturnerBeigeVictorianPillar1','TimeturnerBeigeVictorianPillar2','TimeturnerBeigeVictorianPillar3','TimeturnerBeigeVictorianPillar4','TimeturnerBeigeVictorianPillar5','TimeturnerBrick1','TimeturnerDarkStair','TimeturnerGoldOrnamentBlock','TimeturnerGoldVictorianPillar1','TimeturnerGoldVictorianPillar2','TimeturnerGoldVictorianPillar3','TimeturnerGoldVictorianPillar4','TimeturnerGoldVictorianPillar5','TimeturnerLargeBrick','TimeturnerOrnamentBlock','TimeturnerSmallBrick','TimeturnerVictorianPillar1','TimeturnerVictorianPillar2','TimeturnerVictorianPillar3','TimeturnerVictorianPillar4','TimeturnerVictorianPillar5','TimeturnerWhiteStair','TimeturnergreyStair','bc_block_n','brick_Elevator','brick_block1','brick_block2','brick_block3','brick_block4','brick_block5','brick_block6','brick_block7','brick_block8','brick_front1','brick_front2','brick_front3','brick_front4','brick_front5','brick_front6','brick_front7','brick_front8','bridge_roof_hp','bwHgRoof','bwHgRoof2','bw_sb_fence','byhyra_c17_wall','cas17_block1','cas17_block2','cas17_block3','cas17_block4','cas17_block5','color_block','cstm_j21_ladder','cstm_j21_minecraft_block','cstm_j21_pebble_edge','cstm_j21_snow_edge','cstm_j21_veld_corner','cstm_j21_wall_block','deathPlatform','drinky_23_block_01','drinky_23_block_01_01','drinky_23_platform_01','drinky_23_platform_01_01','drinky_23_wall_01','drinky_23_wall_01_01','habbox_haaziq_concrete_pillar','habbox_haaziq_concrete_wall','habbox_haaziq_pillar','hive_22_dark_timber_block','hive_23_dragon_pillar','hive_23_hotel_pillar','hive_23_reception_wall1','hive_hc3_pillar','hive_ionic_pillar','hogs_stairs','hogs_stairsCn','hogs_stairsHp','hp_block1','hp_corner','hp_ladder','hp_roof','hutRoofBw','kasja_s_fence','kasja_s_ladder','kasja_s_wall','ktchn11_block','marme_stairs','monsterseyes_c17_wall','murop_h17_wall2','roof_brown_blocks','sc_td_block','seyra_toit_1','shone_toit1','shone_toit10','shone_toit11','shone_toit12','shone_toit13','shone_toit14','shone_toit15','shone_toit16','shone_toit17','shone_toit2','shone_toit3','shone_toit4','shone_toit5','shone_toit6','shone_toit7','shone_toit8','shone_toit9','towers_roof','train_wall','verticalStair','wb_saw_corner');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001016, 1850000000, 'Windows & doors', 176, NULL, 16, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001016, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('Atlanta_Japandi_Barn_Door','Atlanta_Japandi_Curtain','Atlanta_Japandi_Window_1','Atlanta_Japandi_Window_2','Atlanta_Japandi_Window_3','Atlanta_Japandi_Window_4','Atlanta_Japandi_Window_5','Atlanta_scandi_door','Atlanta_scandi_window_1','Atlanta_scandi_window_2','BW_HogwartsDoor','BW_MarbleCastleDoor','BW_VictorianWindow','Haaziq_concrete_arch_window','HogwartsDoorBW','KarmaDoor','StoneArchBW','TimeturnerBeigeStoneWindow','TimeturnerEnglishWindow1','TimeturnerEnglishWindow2','TimeturnerEnglishWindow3','TimeturnerStoneWindow','TimeturnerVictorianWindow1','TimeturnerVictorianWindow2','TimeturnerVictorianWindow3','Yvess5_Garage_Door1','Yvess5_Garage_Door2','asth_door10_1x1','asth_door10_1x2','asth_door1_1x2','asth_door2_1x2','asth_door3_1x1','asth_door3_1x2','asth_door4_1x1','asth_door4_1x2','asth_door5_1x1','asth_door5_1x2','asth_door6_1x2','asth_door7_1x1','asth_door7_1x2','asth_door8_1x1','asth_door8_1x2','asth_door9_1x1','asth_door9_1x2','asth_window10_1x1','asth_window10_1x2','asth_window1_1x1','asth_window1_1x2','asth_window1_2x1','asth_window2_1x1','asth_window2_1x2','asth_window2_2x1','asth_window3_1x1','asth_window3_1x2','asth_window4_1x1','asth_window4_1x2','asth_window5_1x1','asth_window5_1x2','asth_window6_1x1','asth_window6_1x2','corvo_doorHP','cstm_j21_green_window','diagon_DoorHp','drinky_23_window_01','drinky_23_window_01_01','drinky_23_window_02_01','duckpub1_gate','grifo_doorHP','habbox_alaska_arosa_fenetre1','habbox_alaska_arosa_fenetre2','habbox_alaska_arosa_porte1','habbox_alaska_arosa_porte2','habbox_haaziq_fenetre','habbox_haaziq_fenetre2','habbox_haaziq_porte_manteau','habbox_haaziq_window','habbox_haaziq_window_2','headmasterDoor','hgwexp_door','hive_23_curtain','hogwart_windowHP1','hp_door1','hp_door2','hp_window','hton_22_osDoor','library17_door1','library17_door2','minister_door','monsterseyes_c17_window','necessitaDoor','romantique_door','secret_door','suburban_bw_gate','train_window','ventana_123_woyke','ventana_hogwarts','wb_saw_gate');

INSERT IGNORE INTO catalog_pages (id, parent_id, caption, icon, required_permission, position, link, layout, catalog_mode, visible, enabled, required_club_level)
VALUES (1850001017, 1850000000, 'Wired', 176, NULL, 17, NULL, 'default_3x3', 'NORMAL', 1, 1, 0);
INSERT IGNORE INTO catalog_page_offers (page_id, offer_id, position)
SELECT 1850001017, offer.id, 0
FROM catalog_offers AS offer
JOIN catalog_offer_products AS product ON product.offer_id = offer.id AND product.product_type = 'furni'
JOIN furniture AS furni ON furni.id = product.furniture_id
JOIN catalog_page_offers AS listed ON listed.offer_id = offer.id
JOIN catalog_pages AS home ON home.id = listed.page_id AND home.parent_id = 1850000000 AND home.id < 1850001000
WHERE furni.item_name IN ('wf_act_add_tag','wf_act_lower_furni','wf_act_match_to_sshot_plus','wf_act_raise_furni','wf_act_remove_tag','wf_act_set_close_dice','wf_act_show_message_room','wf_act_stopGame','wf_act_teleport_blue','wf_act_teleport_green','wf_act_teleport_red','wf_act_teleport_yellow','wf_act_toggle_moodlight','wf_cnd_freeze_booty','wf_cnd_has_tag','wf_cnd_not_freezebb','wf_cnd_not_has_tag','wf_cstm_freeze','wf_trg_cr_earned','wf_trg_exact_keyword','wf_trg_idles','wf_trg_starts_dancing','wf_trg_stopss_dancing','wf_trg_unidles','wf_trg_user_exits_room','wf_trg_win_team');

-- Set pages follow the type pages.
UPDATE catalog_pages SET position = position + 100 WHERE parent_id = 1850000000 AND id < 1850001000 AND position < 100;
