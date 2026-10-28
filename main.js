// ========== 工具函数：敏感信息脱敏 ==========
// 只显示首尾各4位，避免日志泄露密钥
const mask = (str, startLen = 4, endLen = 4) => {
  if (!str || typeof str !== 'string') return '***'
  if (str.length <= startLen + endLen) return '*'.repeat(str.length)
  return str.slice(0, startLen) + '****' + str.slice(-endLen)
}
// ========== GLaDOS 签到核心逻辑 ==========
const glados = async () => {
  const notice = []
  const pointsSummary = [] // 用于最终汇总各账号积分
  let failedAccounts = 0 // 签到失败的账号数，供 main() 判断是否让 Actions 变红
  console.log('========== GLaDOS 签到任务开始 ==========')
  // 环境变量检测
  if (!process.env.GLADOS) {
    console.log('⚠️  未配置 GLADOS 环境变量，跳过签到任务')
    return { notice, failedAccounts, totalAccounts: 0 }
  }
  const agents = String(process.env.GLADOS_UA || '').split('\n').filter(Boolean)
  const cookies = String(process.env.GLADOS).split('\n').filter(Boolean)
  console.log(`📋 共检测到 ${cookies.length} 个账号`)
  console.log(`📋 自定义 UA 数量: ${agents.length}${agents.length < cookies.length ? '（不足时将使用默认UA）' : ''}`)
  for (const [index, cookie] of cookies.entries()) {
    const accountNo = index + 1
    console.log(`\n[账号 ${accountNo}] ---------- 开始处理 ----------`)
    console.log(`[账号 ${accountNo}] Cookie: ${mask(cookie)}`)
    try {
      const domain = process.env.DOMAIN || 'glados.cloud'
      const ua = agents[index] || agents[0] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      
      console.log(`[账号 ${accountNo}] 目标域名: ${domain}`)
      console.log(`[账号 ${accountNo}] UA: ${mask(ua, 8, 8)}`)
      const common = {
        'cookie': cookie,
        'referer': `https://${domain}/console/checkin`,
        'user-agent': ua,
      }
      // 1. 执行签到（与原代码顺序完全一致）
      console.log(`[账号 ${accountNo}] 正在执行签到请求...`)
      const checkinRes = await fetch(`https://${domain}/api/user/checkin`, {
        method: 'POST',
        headers: { ...common, 'content-type': 'application/json' },
        body: JSON.stringify({ token: domain }),
      })
      // HTTP 层错误捕获（网络错误、404、500等）
      if (!checkinRes.ok) {
        throw new Error(`签到接口HTTP错误: ${checkinRes.status} ${checkinRes.statusText}`)
      }
      const action = await checkinRes.json()
      console.log(`[账号 ${accountNo}] 签到接口响应码: ${action?.code ?? '无'}`)
      // code=0 签到成功；code=1 表示今日已签到过（属正常情况，仍继续查询剩余天数与积分）
      const alreadyCheckedIn = action?.code === 1
      if (action?.code !== 0 && !alreadyCheckedIn) {
        throw new Error(`${action?.message || '签到失败'} (code=${action.code}${action?.reason ? ', reason=' + action.reason : ''})`)
      }
      if (alreadyCheckedIn) {
        console.log(`[账号 ${accountNo}] 今日已签到过，继续查询剩余天数与积分...`)
      }
      // 2. 获取账号状态（签到后更新剩余天数）
      console.log(`[账号 ${accountNo}] 正在获取账号状态...`)
      const statusRes = await fetch(`https://${domain}/api/user/status`, {
        method: 'GET',
        headers: { ...common },
      })
      if (!statusRes.ok) {
        throw new Error(`状态接口HTTP错误: ${statusRes.status} ${statusRes.statusText}`)
      }
      const status = await statusRes.json()
      console.log(`[账号 ${accountNo}] 状态接口响应码: ${status?.code ?? '无'}`)
      if (status?.code !== 0) {
        throw new Error(`登录状态异常: ${status?.message || '未知错误'} (code=${status.code})`)
      }
      // 签到成功
      const leftDays = Number(status?.data?.leftDays)

      // ========== 3. 查询当前积分（始终执行，保证运行日志能看到每个账号积分） ==========
      let currentPoints = null
      try {
        console.log(`[账号 ${accountNo}] 正在获取积分...`)
        const pointsRes = await fetch(`https://${domain}/api/user/points`, {
          method: 'GET',
          headers: { ...common },
        })
        if (!pointsRes.ok) {
          throw new Error(`积分接口HTTP错误: ${pointsRes.status} ${pointsRes.statusText}`)
        }
        const pointsData = await pointsRes.json()
        console.log(`[账号 ${accountNo}] 积分接口响应码: ${pointsData?.code ?? '无'}`)
        if (pointsData?.code !== 0) {
          throw new Error(`获取积分失败: ${pointsData?.message || '未知错误'} (code=${pointsData?.code})`)
        }
        currentPoints = Number(pointsData?.points) || 0
        console.log(`[账号 ${accountNo}] 💰 当前积分: ${currentPoints} 点`)
        pointsSummary.push(`账号${accountNo}: ${currentPoints} 点`)
      } catch (pointsErr) {
        console.warn(`[账号 ${accountNo}] ⚠️ 积分查询失败: ${pointsErr.message}`)
        pointsSummary.push(`账号${accountNo}: 查询失败`)
      }

      // 已移除「满 500 积分自动兑换天数」逻辑：不再请求 /api/user/exchange，积分只查询展示、不会被自动消耗

      console.log(`[账号 ${accountNo}] ✅ ${alreadyCheckedIn ? '今日已签到过' : '签到成功'}`)
      console.log(`[账号 ${accountNo}] 返回消息: ${action?.message || (alreadyCheckedIn ? '今日已签到过' : '')}`)
      console.log(`[账号 ${accountNo}] 剩余天数: ${leftDays} 天`)
      console.log(`[账号 ${accountNo}] 当前积分: ${currentPoints != null ? currentPoints + ' 点' : '查询失败'}`)
      notice.push(
        `【账号${accountNo}】签到成功`,
        `${alreadyCheckedIn ? '今日已签到过（无新增积分）' : action?.message}`,
        `剩余天数: ${leftDays} 天`,
        `当前积分: ${currentPoints != null ? currentPoints + ' 点' : '查询失败'}`
      )
    } catch (error) {
      failedAccounts++
      console.error(`[账号 ${accountNo}] ❌ 签到失败`)
      console.error(`[账号 ${accountNo}] 错误详情: ${error.message}`)
      // code=-2 表示服务端不认这个会话（cookie 过期或被踢下线），给出可直接照做的修复指引
      const isAuthError = /code=-2\b/.test(error.message)
      if (isAuthError) {
        console.error(`[账号 ${accountNo}] 👉 Cookie 已失效：请重新登录 GLaDOS，导出新的 cookie 更新 Secret GLADOS`)
      }
      notice.push(
        `【账号${accountNo}】签到失败`,
        `错误: ${error.message}`,
        ...(isAuthError ? ['Cookie 已失效，请重新登录 GLaDOS 并更新 Secret GLADOS'] : []),
        `仓库地址: <${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }
  // 汇总统计
  const totalAccounts = cookies.length
  const successCount = totalAccounts - failedAccounts
  console.log('\n========== 各账号当前积分 ==========')
  if (pointsSummary.length) {
    pointsSummary.forEach(line => console.log(`📊 ${line}`))
  } else {
    console.log('📊 无账号积分数据')
  }
  console.log('===================================')
  console.log('\n========== 签到任务处理完成 ==========')
  console.log(`📊 统计结果：成功 ${successCount} 个 | 失败 ${failedAccounts} 个`)
  return { notice, failedAccounts, totalAccounts }
}
// ========== 通知推送模块 ==========
const notify = async (notice) => {
  console.log('\n========== 通知推送模块开始 ==========')
  if (!process.env.NOTIFY) {
    console.log('⚠️  未配置 NOTIFY 环境变量，跳过推送通知')
    return
  }
  if (!notice || notice.length === 0) {
    console.log('⚠️  无通知内容，跳过推送')
    return
  }
  const options = String(process.env.NOTIFY).split('\n').filter(Boolean)
  console.log(`📋 共配置 ${options.length} 个通知渠道`)
  for (const [idx, option] of options.entries()) {
    const channelNo = idx + 1
    let channelType = '默认(pushplus)'
    try {
      if (option.startsWith('console:')) {
        channelType = '控制台输出'
        console.log(`\n[通知 ${channelNo}] 正在推送至 ${channelType}`)
        console.log('———————— 通知内容 ————————')
        notice.forEach(line => console.log(line))
        console.log('————————————————————————')
        console.log(`[通知 ${channelNo}] ✅ 控制台输出完成`)
      } else if (option.startsWith('wxpusher:')) {
        channelType = 'WxPusher'
        console.log(`\n[通知 ${channelNo}] 正在推送至 ${channelType}`)
        
        const parts = option.split(':')
        const appToken = parts[1]
        const uids = parts.slice(2)
        
        console.log(`[通知 ${channelNo}] appToken: ${mask(appToken)}`)
        console.log(`[通知 ${channelNo}] 推送UID数量: ${uids.length}`)
        const res = await fetch(`https://wxpusher.zjiecode.com/api/send/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            appToken: appToken,
            summary: notice[0],
            content: notice.join('<br>'),
            contentType: 3,
            uids: uids,
          }),
        })
        const result = await res.json()
        console.log(`[通知 ${channelNo}] 接口完整响应: ${JSON.stringify(result)}`)
        if (result.code !== 1000) {
          throw new Error(`${result.msg} (code=${result.code})`)
        }
        console.log(`[通知 ${channelNo}] ✅ WxPusher 推送成功`)
      } else if (option.startsWith('pushplus:')) {
        channelType = 'PushPlus'
        console.log(`\n[通知 ${channelNo}] 正在推送至 ${channelType}`)
        
        const token = option.split(':')[1]
        console.log(`[通知 ${channelNo}] Token: ${mask(token)}`)
        const res = await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: token,
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
        const result = await res.json()
        console.log(`[通知 ${channelNo}] 接口完整响应: ${JSON.stringify(result)}`)
        if (result.code !== 200) {
          throw new Error(`${result.msg} (code=${result.code})`)
        }
        console.log(`[通知 ${channelNo}] ✅ PushPlus 推送成功`)
      } else if (option.startsWith('bark:')) {
        channelType = 'Bark'
        console.log(`\n[通知 ${channelNo}] 正在推送至 ${channelType}`)
        
        const barkKey = option.split(':')[1]
        console.log(`[通知 ${channelNo}] Bark密钥: ${mask(barkKey)}`)
        const res = await fetch(`https://api.day.app/${barkKey}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: notice[0],
            body: notice.slice(1).join('\n'),
          }),
        })
        const result = await res.json()
        console.log(`[通知 ${channelNo}] 接口完整响应: ${JSON.stringify(result)}`)
        if (result.code !== 200) {
          throw new Error(`${result.message} (code=${result.code})`)
        }
        console.log(`[通知 ${channelNo}] ✅ Bark 推送成功`)
      } else if (option.startsWith('qyweixin:')) {
        channelType = '企业微信Webhook'
        console.log(`\n[通知 ${channelNo}] 正在推送至 ${channelType}`)
        
        const qyToken = option.split(':')[1]
        console.log(`[通知 ${channelNo}] Webhook Key: ${mask(qyToken)}`)
        const qyweixinNotifyRebotUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + qyToken
        const res = await fetch(qyweixinNotifyRebotUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
                content: notice.join('<br>')
            }
          }),
        })
        const result = await res.json()
        console.log(`[通知 ${channelNo}] 接口完整响应: ${JSON.stringify(result)}`)
        if (result.errcode !== 0) {
          throw new Error(`${result.errmsg} (errcode=${result.errcode})`)
        }
        console.log(`[通知 ${channelNo}] ✅ 企业微信推送成功`)
      } else {
        // 兼容旧格式：无前缀默认走 pushplus
        channelType = '默认PushPlus(兼容旧格式)'
        console.log(`\n[通知 ${channelNo}] 未识别渠道前缀，使用 ${channelType}`)
        console.log(`[通知 ${channelNo}] Token: ${mask(option)}`)
        const res = await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option,
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
        const result = await res.json()
        console.log(`[通知 ${channelNo}] 接口完整响应: ${JSON.stringify(result)}`)
        if (result.code !== 200) {
          throw new Error(`${result.msg} (code=${result.code})`)
        }
        console.log(`[通知 ${channelNo}] ✅ PushPlus 推送成功`)
      }
    } catch (error) {
      console.error(`[通知 ${channelNo}] ❌ ${channelType} 推送失败`)
      console.error(`[通知 ${channelNo}] 错误详情: ${error.message}`)
      // 单个渠道失败不中断其他渠道推送
    }
  }
  console.log('\n========== 通知推送模块结束 ==========')
}
// ========== 主入口 ==========
const main = async () => {
  const { notice, failedAccounts, totalAccounts } = await glados()
  await notify(notice) // 先推送，保证失败信息送达后再落状态
  // 用 exitCode 而不是 process.exit，避免推送与日志被截断
  if (totalAccounts === 0) {
    console.error('\n❌ 没有可用账号：请检查 Secret GLADOS 是否配置（当前 GLADOS 为空）')
    process.exitCode = 1
  } else if (failedAccounts > 0) {
    console.error(`\n❌ 有 ${failedAccounts}/${totalAccounts} 个账号签到失败，任务标记为失败`)
    process.exitCode = 1
  } else {
    console.log('\n🎉 全部任务执行完毕')
  }
}
// 全局错误捕获，避免程序静默失败
main().catch(err => {
  console.error('❌ 全局未捕获错误:', err)
  process.exit(1)
})
