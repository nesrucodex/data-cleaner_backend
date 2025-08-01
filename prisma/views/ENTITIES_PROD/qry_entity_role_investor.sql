SELECT
  `r`.`name` AS `role_name`,
  `er`.`entity_role_id` AS `investor_id`,
  `e`.`entity_id` AS `entity_id`,
  `e`.`name` AS `investor_name`,
  `er2`.`entity_role_id` AS `intermediary_id`,
  `e2`.`name` AS `intermediary_name`,
  GROUP_CONCAT(`n`.`IBAN` SEPARATOR ',') AS `ibans`
FROM
  (
    (
      (
        (
          (
            `ENTITIES_PROD`.`role` `r`
            LEFT JOIN `ENTITIES_PROD`.`entity_role` `er` ON((`r`.`role_id` = `er`.`role_id`))
          )
          LEFT JOIN `ENTITIES_PROD`.`entity` `e` ON((`e`.`entity_id` = `er`.`entity_id`))
        )
        LEFT JOIN `ENTITIES_PROD`.`entity_role` `er2` ON((`er`.`parent_role_id` = `er2`.`entity_role_id`))
      )
      LEFT JOIN `ENTITIES_PROD`.`entity` `e2` ON((`er2`.`entity_id` = `e2`.`entity_id`))
    )
    LEFT JOIN `ENTITIES_PROD`.`bank_account` `n` ON((`er`.`entity_id` = `n`.`entity_id`))
  )
WHERE
  (`r`.`role_id` = 2)
GROUP BY
  `r`.`name`,
  `er`.`entity_role_id`,
  `e`.`entity_id`,
  `e`.`name`,
  `er2`.`entity_role_id`,
  `e2`.`name`