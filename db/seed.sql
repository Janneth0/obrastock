INSERT INTO obras (id, nombre, presupuesto, gasto) VALUES ('O1','Edificio Palermo',4000000,3350000), ('O2','Casa Tigre',1800000,420000);
INSERT INTO materiales (codigo, descripcion, unidad, stock, minimo, costo) VALUES
 ('MAT-001','Cemento 50 kg','bolsa',80,40,9500), ('MAT-002','Arena','m³',12,6,28000),
 ('MAT-003','Ladrillo hueco 12','u',1500,800,450), ('MAT-004','Hierro 8 mm','barra',60,30,7800);
INSERT INTO movimientos (ts, codigo, obra_id, tipo, cantidad, responsable)
 SELECT now() - i * interval '1 day', 'MAT-001', 'O1', 'egreso', 9, 'Capataz' FROM generate_series(1,6) i;
INSERT INTO movimientos (ts, codigo, obra_id, tipo, cantidad, responsable)
 SELECT now() - i * interval '1 day', 'MAT-004', 'O1', 'egreso', 3, 'Capataz' FROM generate_series(1,6) i;
