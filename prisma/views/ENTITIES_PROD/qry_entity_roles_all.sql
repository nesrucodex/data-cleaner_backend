SELECT
  `r`.`role_id` AS `role_id`,
  `r`.`name` AS `role_name`,
  `er`.`entity_role_id` AS `entity_role_id`,
  `er`.`entity_id` AS `entity_id`,
  `e`.`name` AS `entity_name`,
  `e`.`trade_name` AS `trade_name`,
  `er`.`parent_role_id` AS `parent_role_id`,
  `er`.`related_role_id` AS `related_role_id`
FROM
  (
    (
      `ENTITIES_PROD`.`role` `r`
      JOIN `ENTITIES_PROD`.`entity_role` `er` ON((`r`.`role_id` = `er`.`role_id`))
    )
    JOIN `ENTITIES_PROD`.`entity` `e` ON((`e`.`entity_id` = `er`.`entity_id`))
  )