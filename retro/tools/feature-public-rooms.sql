-- Features the ten 2015 public rooms in the navigator again, using their current room ids.
-- Run it in Adminer, then type :update navigator in any room. Safe to run again.
SET @site = 'https://retro.steamvaluechecker.com';
DELETE p FROM navigator_publics p JOIN rooms r ON r.id = p.room_id WHERE r.model_name IN ('model_wl15','model_hcl15','model_cnx15','model_gh15','model_cof15','model_cofsr15','model_hall1','model_hall2','model_hall3','model_ofc15');

INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Welcome Lobby','Start here. The front desk, lounge and the way to everywhere else.',CONCAT(@site,'/images/rooms/wl15/wl15_a.png'),1,1 FROM rooms WHERE model_name = 'model_wl15';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'HC Lounge','A club lounge with a bar, DJ booth and aquarium views.',CONCAT(@site,'/images/rooms/hcl15/hcl15_a.png'),2,1 FROM rooms WHERE model_name = 'model_hcl15';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Club NX','Dance floor, bar and VIP seating.',CONCAT(@site,'/images/rooms/cnx15/cnx15_a.png'),3,1 FROM rooms WHERE model_name = 'model_cnx15';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Game Hub','Pick a game and jump in.',CONCAT(@site,'/images/rooms/gh15/gh15_a.png'),4,1 FROM rooms WHERE model_name = 'model_gh15';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Coffee House','Grab a coffee and a seat.',CONCAT(@site,'/images/rooms/cof15/cof15_a.png'),5,1 FROM rooms WHERE model_name = 'model_cof15';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Coffee House Storeroom','The back room of the Coffee House.',CONCAT(@site,'/images/rooms/cofsr15/cofsr15_a.png'),6,1 FROM rooms WHERE model_name = 'model_cofsr15';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Hallway 1','A quiet hallway between rooms.',CONCAT(@site,'/images/rooms/hall1/hall1_a.png'),7,1 FROM rooms WHERE model_name = 'model_hall1';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Hallway 2','A quiet hallway between rooms.',CONCAT(@site,'/images/rooms/hall2/hall2_a.png'),8,1 FROM rooms WHERE model_name = 'model_hall2';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Hallway 3','A quiet hallway between rooms.',CONCAT(@site,'/images/rooms/hall3/hall3_a.png'),9,1 FROM rooms WHERE model_name = 'model_hall3';
INSERT INTO navigator_publics (room_id,caption,description,image_url,order_num,enabled) SELECT id,'Main Office','The main office behind the welcome lounge.','',10,1 FROM rooms WHERE model_name = 'model_ofc15';
