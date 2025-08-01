SELECT
  `r`.`name` AS `role_name`,
  `er`.`entity_role_id` AS `debtor_id`,
  `er`.`entity_id` AS `entity_id`,
  `e`.`name` AS `debtor_name`,
  `er2`.`entity_role_id` AS `originator_id`,
  `e2`.`name` AS `originator_name`,
  `er`.`related_role_id` AS `credebtor_id`,
  `e3`.`name` AS `credebtor_name`,
  count(DISTINCT `b`.`IBAN`) AS `iban_count`,
  count(DISTINCT `b`.`account`) AS `account_count`,
  GROUP_CONCAT(DISTINCT `b`.`IBAN` SEPARATOR ',') AS `ibans`,
  GROUP_CONCAT(DISTINCT `b`.`account` SEPARATOR ',') AS `accounts`,
  GROUP_CONCAT(DISTINCT `b`.`account_ref` SEPARATOR ',') AS `account_refs`
FROM
  (
    (
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
          LEFT JOIN `ENTITIES_PROD`.`entity` `e2` ON((`e2`.`entity_id` = `er2`.`entity_id`))
        )
        LEFT JOIN `ENTITIES_PROD`.`entity_role` `er3` ON(
          (`er3`.`entity_role_id` = `er`.`related_role_id`)
        )
      )
      LEFT JOIN `ENTITIES_PROD`.`entity` `e3` ON((`er3`.`entity_id` = `e3`.`entity_id`))
    )
    LEFT JOIN `ENTITIES_PROD`.`bank_account` `b` ON((`b`.`entity_id` = `er`.`entity_id`))
  )
WHERE
  (`r`.`role_id` = 10)
GROUP BY
  `r`.`name`,
  `er`.`entity_role_id`,
  `er`.`entity_id`,
  `e`.`name`,
  `er2`.`entity_role_id`,
  `e2`.`name`,
  `er`.`related_role_id`,
  `e3`.`name`