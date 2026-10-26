import "server-only";
import { getDb } from "./db";

export function customerAccessDetails(customerId: number) {
  const db = getDb();
  return {
    owner:
      db
        .prepare(
          "SELECT u.id,u.name,u.role,u.status FROM customers c JOIN users u ON u.id=c.owner_id WHERE c.id=?",
        )
        .get(customerId) || null,
    grants: db
      .prepare(
        "SELECT u.id,u.name,u.role,u.status FROM customer_access a JOIN users u ON u.id=a.user_id WHERE a.customer_id=? ORDER BY u.name,u.id",
      )
      .all(customerId),
  };
}

// The HTTP boundary must require an administrator before calling this helper.
export function changeCustomerAccess(
  customerId: number,
  userId: number,
  action: string,
) {
  const db = getDb();
  if (!Number.isSafeInteger(userId) || userId < 1)
    throw new Error("请选择有效账号");
  db.exec("BEGIN IMMEDIATE");
  try {
    const customer = db
      .prepare("SELECT owner_id FROM customers WHERE id=?")
      .get(customerId) as { owner_id: number | null } | undefined;
    const user = db
      .prepare("SELECT role,status FROM users WHERE id=?")
      .get(userId) as { role: string; status: string } | undefined;
    if (!customer || !user) throw new Error("客户或账号不存在");
    if (action === "revoke") {
      if (customer.owner_id === userId)
        throw new Error("负责人拥有固有访问权限，请先转交客户");
      if (user.role === "admin")
        throw new Error("管理员拥有全局访问权限，不能按客户撤销");
      db.prepare(
        "DELETE FROM customer_access WHERE customer_id=? AND user_id=?",
      ).run(customerId, userId);
    } else {
      if (user.status !== "active") throw new Error("账号已停用");
      if (action === "grant") {
        if (user.role === "admin")
          throw new Error("管理员已有全局权限，无需重复授权");
        if (customer.owner_id !== userId)
          db.prepare(
            "INSERT OR IGNORE INTO customer_access(customer_id,user_id) VALUES(?,?)",
          ).run(customerId, userId);
      } else if (action === "transfer") {
        if (user.role === "viewer") throw new Error("只读账号不能担任负责人");
        db.prepare(
          "UPDATE customers SET owner_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(userId, customerId);
        db.prepare(
          "DELETE FROM customer_access WHERE customer_id=? AND user_id IN (?,?)",
        ).run(customerId, userId, customer.owner_id);
      } else throw new Error("未知授权操作");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
