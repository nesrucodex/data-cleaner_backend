SELECT
  `r`.`name` AS `role_name`,
  `er`.`entity_role_id` AS `credebtor_id`,
  `e`.`entity_id` AS `entity_id`,
  `e`.`name` AS `credebtor_name`,
  count(`ENTITIES_PROD`.`d`.`debtor_id`) AS `debtor_count`,
(
    SELECT
      count(0)
    FROM
      `ENTITIES_PROD`.`qry_entity_role_creditor` `q`
    WHERE
      (
        `ENTITIES_PROD`.`q`.`credebtor_id` = `er`.`entity_role_id`
      )
  ) AS `creditor_count`,
  sum(`ENTITIES_PROD`.`d`.`iban_count`) AS `debtor_iban_count`,
  sum(`ENTITIES_PROD`.`d`.`account_count`) AS `debtor_account_count`,
(
    SELECT
      sum(`ENTITIES_PROD`.`q`.`iban_count`)
    FROM
      `ENTITIES_PROD`.`qry_entity_role_creditor` `q`
    WHERE
      (
        `ENTITIES_PROD`.`q`.`credebtor_id` = `er`.`entity_role_id`
      )
  ) AS `creditor_iban_count`,
(
    SELECT
      sum(`ENTITIES_PROD`.`q`.`account_count`)
    FROM
      `ENTITIES_PROD`.`qry_entity_role_creditor` `q`
    WHERE
      (
        `ENTITIES_PROD`.`q`.`credebtor_id` = `er`.`entity_role_id`
      )
  ) AS `creditor_account_count`
FROM
  (
    (
      (
        `ENTITIES_PROD`.`role` `r`
        LEFT JOIN `ENTITIES_PROD`.`entity_role` `er` ON((`r`.`role_id` = `er`.`role_id`))
      )
      LEFT JOIN `ENTITIES_PROD`.`entity` `e` ON((`e`.`entity_id` = `er`.`entity_id`))
    )
    LEFT JOIN `ENTITIES_PROD`.`qry_entity_role_debtor` `d` ON(
      (
        `ENTITIES_PROD`.`d`.`credebtor_id` = `er`.`entity_role_id`
      )
    )
  )
WHERE
  (`r`.`role_id` = 9)
GROUP BY
  `r`.`name`,
  `er`.`entity_role_id`,
  `e`.`entity_id`,
  `e`.`name`
ORDER BY
  `e`.`name`