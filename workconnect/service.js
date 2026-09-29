'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PAGE_SIZE = 20;
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '..', 'data', 'workconnect-media');
const PUBLIC_MEDIA_PURPOSES = new Set(['avatar', 'cover', 'portfolio', 'post']);
const ALLOWED_MEDIA = new Map([
    ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif'],
    ['application/pdf', '.pdf'], ['video/mp4', '.mp4'], ['video/webm', '.webm']
]);
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

function createWorkConnectService({ database }) {
    if (process.env.NODE_ENV === 'production' && !String(process.env.WORKCONNECT_MEDIA_ROOT || '').trim()) {
        throw new Error('WORKCONNECT_MEDIA_ROOT is required in production so WorkConnect media uses persistent storage.');
    }
    return {
        async ensureProfile(userId, username) {
            const slug = slugify(username) || `user-${userId}`;
            const result = await database.query(
                `INSERT INTO workconnect_profiles(user_id, slug)
                 VALUES ($1, $2)
                 ON CONFLICT(user_id) DO UPDATE SET user_id = EXCLUDED.user_id
                 RETURNING *`, [userId, `${slug}-${userId}`]
            );
            return result.rows[0];
        },
        handle: (ctx) => handleApi({ ...ctx, database })
    };
}

async function handleApi({ req, res, session, requestUrl, database, assertSameOrigin }) {
    const pathname = requestUrl.pathname;
    if (!session) return json(res, 401, { error: 'Sign in to use WorkConnect.' });
    const userId = Number(session.userId);
    if (!Number.isInteger(userId)) return json(res, 401, { error: 'Invalid session.' });
    if (!['GET', 'HEAD'].includes(req.method)) assertSameOrigin(req);

    try {
        if (req.method === 'GET' && pathname === '/api/workconnect/bootstrap') {
            await ensureProfile(database, userId, session.username);
            const [profile, categories, skills, notifications] = await Promise.all([
                getProfile(database, userId, userId),
                database.query(`SELECT id,name,slug,aliases,parent_id FROM workconnect_categories WHERE active=TRUE ORDER BY name ASC`),
                database.query(`SELECT id,name,slug,aliases FROM workconnect_skills WHERE active=TRUE ORDER BY name ASC LIMIT 500`),
                database.query(`SELECT COUNT(*)::int AS count FROM workconnect_notifications WHERE user_id=$1 AND read_at IS NULL`, [userId])
            ]);
            return json(res, 200, { profile, categories: categories.rows, skills: skills.rows, unreadNotifications: notifications.rows[0].count });
        }

        if (req.method === 'GET' && pathname === '/api/workconnect/profile/me') {
            await ensureProfile(database, userId, session.username);
            return json(res, 200, { profile: await getProfile(database, userId, userId) });
        }
        if (req.method === 'PUT' && pathname === '/api/workconnect/profile/me') {
            const body = await readJson(req);
            await ensureProfile(database, userId, session.username);
            const p = validateProfile(body);
            await database.withTransaction(async (client) => {
                await client.query(
                    `UPDATE workconnect_profiles SET headline=$2,account_type=$3,profession=$4,primary_category_id=$5,years_experience=$6,bio=$7,
                     education=$8,availability=$9,schedule_text=$10,employment_type=$11,starting_rate_minor=$12,rate_currency=$13,
                     contact_preferences=$14::jsonb,public_fields=$15::jsonb,college=$16,department=$17,updated_at=NOW() WHERE user_id=$1`,
                    [userId,p.headline,p.accountType,p.profession,p.primaryCategoryId,p.yearsExperience,p.bio,p.education,p.availability,p.scheduleText,
                     p.employmentType,p.startingRateMinor,p.rateCurrency,JSON.stringify(p.contactPreferences),JSON.stringify(p.publicFields),p.college,p.department]
                );
                if (Array.isArray(body.capabilities)) {
                    await client.query('DELETE FROM workconnect_capabilities WHERE user_id=$1', [userId]);
                    for (const cap of body.capabilities.filter(validCapability)) {
                        await client.query('INSERT INTO workconnect_capabilities(user_id,capability) VALUES($1,$2) ON CONFLICT DO NOTHING', [userId,cap]);
                    }
                }
                if (Array.isArray(body.skills)) {
                    await client.query('DELETE FROM workconnect_profile_skills WHERE user_id=$1', [userId]);
                    for (const name of uniqueStrings(body.skills, 30, 100)) {
                        const slug = slugify(name); if (!slug) continue;
                        const skill = await client.query(`INSERT INTO workconnect_skills(name,slug) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [name,slug]);
                        await client.query('INSERT INTO workconnect_profile_skills(user_id,skill_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [userId,skill.rows[0].id]);
                    }
                }
            });
            return json(res, 200, { profile: await getProfile(database, userId, userId) });
        }
        const publicProfile = pathname.match(/^\/api\/workconnect\/profiles\/(\d+)$/);
        if (req.method === 'GET' && publicProfile) {
            const targetId = Number(publicProfile[1]);
            const blocked = await isBlocked(database, userId, targetId);
            if (blocked) return json(res, 404, { error: 'Profile not found.' });
            const profile = await getProfile(database, targetId, userId);
            return profile ? json(res, 200, { profile }) : json(res, 404, { error: 'Profile not found.' });
        }

        if (pathname === '/api/workconnect/locations' && req.method === 'GET') {
            const r = await database.query(`SELECT id,label,city,district,state,postal_code,country_code,latitude,longitude,radius_km,is_primary FROM workconnect_service_locations WHERE user_id=$1 ORDER BY is_primary DESC,id`, [userId]);
            return json(res, 200, { locations: r.rows });
        }
        if (pathname === '/api/workconnect/locations' && req.method === 'POST') {
            const b = await readJson(req); const loc = validateLocation(b);
            const r = await database.query(`INSERT INTO workconnect_service_locations(user_id,label,city,district,state,postal_code,country_code,latitude,longitude,radius_km,is_primary)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [userId,loc.label,loc.city,loc.district,loc.state,loc.postalCode,loc.countryCode,loc.latitude,loc.longitude,loc.radiusKm,loc.isPrimary]);
            return json(res, 201, { location: r.rows[0] });
        }
        const locationId = pathname.match(/^\/api\/workconnect\/locations\/(\d+)$/);
        if (locationId && req.method === 'DELETE') {
            const r = await database.query('DELETE FROM workconnect_service_locations WHERE id=$1 AND user_id=$2 RETURNING id', [Number(locationId[1]),userId]);
            return r.rowCount ? json(res,200,{deleted:true}) : json(res,404,{error:'Location not found.'});
        }

        if (pathname === '/api/workconnect/discover' && req.method === 'GET') {
            return json(res, 200, await discoverProfessionals(database, userId, requestUrl.searchParams));
        }
        if (pathname === '/api/workconnect/search' && req.method === 'GET') {
            return json(res, 200, await globalSearch(database, userId, requestUrl.searchParams));
        }

        if (pathname === '/api/workconnect/posts' && req.method === 'GET') {
            return json(res, 200, await listPosts(database, userId, requestUrl.searchParams));
        }
        if (pathname === '/api/workconnect/posts' && req.method === 'POST') {
            const b=await readJson(req); const body=text(b.body,1,10000,'Post text'); const category=postCategory(b.category);
            if (Array.isArray(b.mediaIds) && b.mediaIds.length && b.permissionConfirmed !== true) return json(res,400,{error:'Confirm you have permission to publish the attached media.'});
            const r=await database.query(`INSERT INTO workconnect_posts(author_user_id,category,body,permission_confirmed) VALUES($1,$2,$3,$4) RETURNING *`,[userId,category,body,b.permissionConfirmed===true]);
            await attachMedia(database,userId,'post',r.rows[0].id,b.mediaIds);
            return json(res,201,{post:r.rows[0]});
        }
        const postId=pathname.match(/^\/api\/workconnect\/posts\/(\d+)$/);
        if(postId && req.method==='PUT'){
            const b=await readJson(req); const r=await database.query(`UPDATE workconnect_posts SET body=$3,category=$4,updated_at=NOW() WHERE id=$1 AND author_user_id=$2 RETURNING *`,[Number(postId[1]),userId,text(b.body,1,10000,'Post text'),postCategory(b.category)]);
            return r.rowCount?json(res,200,{post:r.rows[0]}):json(res,404,{error:'Post not found.'});
        }
        if(postId && req.method==='DELETE'){
            const r=await database.query('DELETE FROM workconnect_posts WHERE id=$1 AND author_user_id=$2 RETURNING id',[Number(postId[1]),userId]);
            return r.rowCount?json(res,200,{deleted:true}):json(res,404,{error:'Post not found.'});
        }
        const like=pathname.match(/^\/api\/workconnect\/posts\/(\d+)\/like$/);
        if(like && req.method==='PUT'){
            const pid=Number(like[1]); const b=await readJson(req);
            if(b.liked===false) await database.query('DELETE FROM workconnect_post_likes WHERE post_id=$1 AND user_id=$2',[pid,userId]);
            else await database.query('INSERT INTO workconnect_post_likes(post_id,user_id) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM workconnect_posts WHERE id=$1) ON CONFLICT DO NOTHING',[pid,userId]);
            const c=await database.query('SELECT COUNT(*)::int count FROM workconnect_post_likes WHERE post_id=$1',[pid]); return json(res,200,{liked:b.liked!==false,count:c.rows[0].count});
        }
        const comments=pathname.match(/^\/api\/workconnect\/posts\/(\d+)\/comments$/);
        if(comments && req.method==='POST'){
            const b=await readJson(req); const r=await database.query(`INSERT INTO workconnect_post_comments(post_id,author_user_id,body) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM workconnect_posts WHERE id=$1) RETURNING *`,[Number(comments[1]),userId,text(b.body,1,3000,'Comment')]);
            return r.rowCount?json(res,201,{comment:r.rows[0]}):json(res,404,{error:'Post not found.'});
        }
        const commentId=pathname.match(/^\/api\/workconnect\/comments\/(\d+)$/);
        if(commentId && req.method==='DELETE'){
            const r=await database.query('DELETE FROM workconnect_post_comments WHERE id=$1 AND author_user_id=$2 RETURNING id',[Number(commentId[1]),userId]); return r.rowCount?json(res,200,{deleted:true}):json(res,404,{error:'Comment not found.'});
        }
        const follow=pathname.match(/^\/api\/workconnect\/profiles\/(\d+)\/follow$/);
        if(follow && req.method==='PUT'){
            const target=Number(follow[1]); if(target===userId)return json(res,400,{error:'You cannot follow yourself.'}); const b=await readJson(req);
            if(b.following===false) await database.query('DELETE FROM workconnect_follows WHERE follower_user_id=$1 AND followed_user_id=$2',[userId,target]);
            else { await database.query('INSERT INTO workconnect_follows(follower_user_id,followed_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,target]); await notify(database,target,userId,'follow','profile',userId,`${session.username} followed you.`,`follow:${userId}`); }
            return json(res,200,{following:b.following!==false});
        }

        if(pathname==='/api/workconnect/portfolio' && req.method==='GET'){
            const target=positiveInt(requestUrl.searchParams.get('userId'))||userId; const r=await database.query(`SELECT p.*,COALESCE(json_agg(json_build_object('id',m.id,'url','/api/workconnect/media/'||m.id,'mimeType',m.mime_type)) FILTER(WHERE m.id IS NOT NULL),'[]') media FROM workconnect_portfolio_projects p LEFT JOIN workconnect_portfolio_media pm ON pm.project_id=p.id LEFT JOIN workconnect_media m ON m.id=pm.media_id WHERE p.user_id=$1 GROUP BY p.id ORDER BY p.created_at DESC`,[target]); return json(res,200,{projects:r.rows});
        }
        if(pathname==='/api/workconnect/portfolio' && req.method==='POST'){
            const b=await readJson(req); const r=await database.query(`INSERT INTO workconnect_portfolio_projects(user_id,title,description,category_id,location_label,started_on,completed_on,cost_minor,currency,show_cost,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[userId,text(b.title,1,160,'Title'),textOptional(b.description,5000),nullableInt(b.categoryId),textOptional(b.locationLabel,160),dateOrNull(b.startedOn),dateOrNull(b.completedOn),moneyOrNull(b.costMinor),currency(b.currency),b.showCost===true,['planned','in_progress','completed'].includes(b.status)?b.status:'completed']); await attachMedia(database,userId,'portfolio',r.rows[0].id,b.mediaIds); return json(res,201,{project:r.rows[0]});
        }
        const projectId=pathname.match(/^\/api\/workconnect\/portfolio\/(\d+)$/);
        if(projectId&&req.method==='DELETE'){const r=await database.query('DELETE FROM workconnect_portfolio_projects WHERE id=$1 AND user_id=$2 RETURNING id',[Number(projectId[1]),userId]);return r.rowCount?json(res,200,{deleted:true}):json(res,404,{error:'Project not found.'});}

        if(pathname==='/api/workconnect/jobs'&&req.method==='GET') return json(res,200,await listJobs(database,userId,requestUrl.searchParams));
        if(pathname==='/api/workconnect/jobs'&&req.method==='POST'){
            const b=await readJson(req); const j=validateJob(b); const r=await database.query(`INSERT INTO workconnect_jobs(owner_user_id,kind,title,category_id,description,location_label,latitude,longitude,workplace_type,contract_type,duration_text,experience_years,min_amount_minor,max_amount_minor,currency,openings,deadline,status,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CASE WHEN $18='published' THEN NOW() ELSE NULL END) RETURNING *`,[userId,j.kind,j.title,j.categoryId,j.description,j.locationLabel,j.latitude,j.longitude,j.workplaceType,j.contractType,j.durationText,j.experienceYears,j.minAmountMinor,j.maxAmountMinor,j.currency,j.openings,j.deadline,j.status]); return json(res,201,{job:r.rows[0]});
        }
        const jobId=pathname.match(/^\/api\/workconnect\/jobs\/(\d+)$/);
        if(jobId&&req.method==='PUT'){
            const b=await readJson(req); const j=validateJob(b); const r=await database.query(`UPDATE workconnect_jobs SET kind=$3,title=$4,category_id=$5,description=$6,location_label=$7,latitude=$8,longitude=$9,workplace_type=$10,contract_type=$11,duration_text=$12,experience_years=$13,min_amount_minor=$14,max_amount_minor=$15,currency=$16,openings=$17,deadline=$18,status=$19,published_at=CASE WHEN $19='published' AND published_at IS NULL THEN NOW() ELSE published_at END,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 RETURNING *`,[Number(jobId[1]),userId,j.kind,j.title,j.categoryId,j.description,j.locationLabel,j.latitude,j.longitude,j.workplaceType,j.contractType,j.durationText,j.experienceYears,j.minAmountMinor,j.maxAmountMinor,j.currency,j.openings,j.deadline,j.status]); return r.rowCount?json(res,200,{job:r.rows[0]}):json(res,404,{error:'Job not found.'});
        }
        const apply=pathname.match(/^\/api\/workconnect\/jobs\/(\d+)\/applications$/);
        if(apply&&req.method==='POST'){
            const jid=Number(apply[1]); const b=await readJson(req); const job=await database.query(`SELECT * FROM workconnect_jobs WHERE id=$1 AND status='published' AND (deadline IS NULL OR deadline>NOW())`,[jid]); if(!job.rowCount)return json(res,409,{error:'This opportunity is not accepting applications.'}); if(Number(job.rows[0].owner_user_id)===userId)return json(res,400,{error:'You cannot apply to your own opportunity.'});
            try{const r=await database.query(`INSERT INTO workconnect_job_applications(job_id,applicant_user_id,cover_message,availability,quote_minor,quote_currency) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[jid,userId,textOptional(b.coverMessage,5000),textOptional(b.availability,160),moneyOrNull(b.quoteMinor),currency(b.quoteCurrency)]); await notify(database,Number(job.rows[0].owner_user_id),userId,'application','job',jid,`${session.username} applied to ${job.rows[0].title}.`,`application:${r.rows[0].id}`); return json(res,201,{application:r.rows[0]});}catch(e){if(e.code==='23505')return json(res,409,{error:'You already applied to this opportunity.'});throw e;}
        }
        if(apply&&req.method==='GET'){
            const jid=Number(apply[1]); const own=await database.query('SELECT 1 FROM workconnect_jobs WHERE id=$1 AND owner_user_id=$2',[jid,userId]); if(!own.rowCount)return json(res,403,{error:'Only the listing owner can view applicants.'}); const r=await database.query(`SELECT a.*,u.username,p.headline,p.profession FROM workconnect_job_applications a JOIN users u ON u.id=a.applicant_user_id LEFT JOIN workconnect_profiles p ON p.user_id=u.id WHERE a.job_id=$1 ORDER BY a.created_at DESC`,[jid]); return json(res,200,{applications:r.rows});
        }
        const appStatus=pathname.match(/^\/api\/workconnect\/applications\/(\d+)$/);
        if(appStatus&&req.method==='PUT') return handleApplicationStatus(database,res,userId,Number(appStatus[1]),await readJson(req));
        if(pathname==='/api/workconnect/applications/mine'&&req.method==='GET'){const r=await database.query(`SELECT a.*,j.title,j.kind,j.status job_status FROM workconnect_job_applications a JOIN workconnect_jobs j ON j.id=a.job_id WHERE a.applicant_user_id=$1 ORDER BY a.created_at DESC`,[userId]);return json(res,200,{applications:r.rows});}

        if(pathname==='/api/workconnect/inquiries'&&req.method==='GET'){
            const r=await database.query(`SELECT i.*,cu.username customer_name,wu.username worker_name, q.id quote_id,q.amount_minor quote_amount_minor,q.currency quote_currency,q.message quote_message,q.status quote_status FROM workconnect_service_inquiries i JOIN users cu ON cu.id=i.customer_user_id JOIN users wu ON wu.id=i.worker_user_id LEFT JOIN LATERAL (SELECT * FROM workconnect_service_quotes x WHERE x.inquiry_id=i.id ORDER BY x.created_at DESC LIMIT 1) q ON TRUE WHERE i.customer_user_id=$1 OR i.worker_user_id=$1 ORDER BY i.created_at DESC`,[userId]); return json(res,200,{inquiries:r.rows});
        }
        if(pathname==='/api/workconnect/inquiries'&&req.method==='POST'){
            const b=await readJson(req),workerId=positiveInt(b.workerUserId); if(!workerId||workerId===userId)return json(res,400,{error:'Choose another professional.'}); const r=await database.query(`INSERT INTO workconnect_service_inquiries(customer_user_id,worker_user_id,work_type,description,location_label,preferred_date,budget_minor,currency,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[userId,workerId,text(b.workType,1,160,'Work type'),text(b.description,1,5000,'Description'),textOptional(b.locationLabel,180),dateOrNull(b.preferredDate),moneyOrNull(b.budgetMinor),currency(b.currency),textOptional(b.notes,3000)]); await notify(database,workerId,userId,'inquiry','inquiry',r.rows[0].id,`${session.username} sent you a service inquiry.`,`inquiry:${r.rows[0].id}`); return json(res,201,{inquiry:r.rows[0]});
        }
        const inquiryStatus=pathname.match(/^\/api\/workconnect\/inquiries\/(\d+)$/);
        if(inquiryStatus&&req.method==='PUT') return handleInquiryStatus(database,res,userId,Number(inquiryStatus[1]),await readJson(req));
        const quote=pathname.match(/^\/api\/workconnect\/inquiries\/(\d+)\/quotes$/);
        if(quote&&req.method==='POST') return createQuote(database,res,userId,Number(quote[1]),await readJson(req));
        const quoteStatus=pathname.match(/^\/api\/workconnect\/quotes\/(\d+)$/);
        if(quoteStatus&&req.method==='PUT') return updateQuote(database,res,userId,Number(quoteStatus[1]),await readJson(req));

        if(pathname==='/api/workconnect/conversations'&&req.method==='GET') return json(res,200,await listConversations(database,userId));
        if(pathname==='/api/workconnect/conversations'&&req.method==='POST') return createConversation(database,res,userId,await readJson(req));
        const conv=pathname.match(/^\/api\/workconnect\/conversations\/(\d+)\/messages$/);
        if(conv&&req.method==='GET') return json(res,200,await getMessages(database,userId,Number(conv[1]),requestUrl.searchParams));
        if(conv&&req.method==='POST'){
            const cid=Number(conv[1]); const member=await database.query('SELECT 1 FROM workconnect_conversation_participants WHERE conversation_id=$1 AND user_id=$2',[cid,userId]); if(!member.rowCount)return json(res,403,{error:'Conversation not available.'}); const b=await readJson(req); const blocked=await conversationBlocked(database,cid,userId); if(blocked)return json(res,403,{error:'Messaging is unavailable because one participant has blocked the other.'}); const r=await database.query(`INSERT INTO workconnect_messages(conversation_id,sender_user_id,body) VALUES($1,$2,$3) RETURNING *`,[cid,userId,text(b.body,1,5000,'Message')]); await database.query('UPDATE workconnect_conversations SET updated_at=NOW() WHERE id=$1',[cid]); return json(res,201,{message:r.rows[0]});
        }
        const readConv=pathname.match(/^\/api\/workconnect\/conversations\/(\d+)\/read$/);
        if(readConv&&req.method==='PUT'){await database.query('UPDATE workconnect_conversation_participants SET last_read_at=NOW() WHERE conversation_id=$1 AND user_id=$2',[Number(readConv[1]),userId]);return json(res,200,{read:true});}

        if(pathname==='/api/workconnect/notifications'&&req.method==='GET'){const r=await database.query(`SELECT * FROM workconnect_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[userId]);return json(res,200,{notifications:r.rows});}
        if(pathname==='/api/workconnect/notifications/read-all'&&req.method==='PUT'){await database.query('UPDATE workconnect_notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1',[userId]);return json(res,200,{updated:true});}

        if(pathname==='/api/workconnect/reviews'&&req.method==='POST') return createReview(database,res,userId,await readJson(req));
        if(pathname==='/api/workconnect/reports'&&req.method==='POST'){
            const b=await readJson(req); const types=['profile','post','comment','job','review','message']; if(!types.includes(b.targetType)||!positiveInt(b.targetId))return json(res,400,{error:'Invalid report target.'}); const r=await database.query(`INSERT INTO workconnect_reports(reporter_user_id,target_type,target_id,reason,details) VALUES($1,$2,$3,$4,$5) RETURNING id,status,created_at`,[userId,b.targetType,Number(b.targetId),text(b.reason,1,80,'Reason'),textOptional(b.details,3000)]);return json(res,201,{report:r.rows[0]});
        }
        const block=pathname.match(/^\/api\/workconnect\/profiles\/(\d+)\/block$/);
        if(block&&req.method==='PUT'){const target=Number(block[1]);if(target===userId)return json(res,400,{error:'You cannot block yourself.'});const b=await readJson(req);if(b.blocked===false)await database.query('DELETE FROM workconnect_blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2',[userId,target]);else await database.query('INSERT INTO workconnect_blocks(blocker_user_id,blocked_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,target]);return json(res,200,{blocked:b.blocked!==false});}

        if(pathname==='/api/workconnect/media'&&req.method==='POST') return uploadMedia(req,res,database,userId,requestUrl.searchParams);
        const media=pathname.match(/^\/api\/workconnect\/media\/([0-9a-f-]{36})$/i);
        if(media&&req.method==='GET') return serveMedia(res,database,userId,media[1]);
        if(media&&req.method==='DELETE') return deleteMedia(res,database,userId,media[1]);

        return json(res,404,{error:'WorkConnect endpoint not found.'});
    } catch (error) {
        if (error && error.publicMessage) return json(res,error.statusCode||400,{error:error.publicMessage});
        console.error('WorkConnect error:', error);
        return json(res,500,{error:'WorkConnect request failed.'});
    }
}

async function ensureProfile(db,userId,username){const slug=slugify(username)||`user-${userId}`;await db.query(`INSERT INTO workconnect_profiles(user_id,slug) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING`,[userId,`${slug}-${userId}`]);}
async function getProfile(db,targetId,viewerId){
 const r=await db.query(`SELECT p.*,u.username,
 COALESCE((SELECT json_agg(c.capability ORDER BY c.capability) FROM workconnect_capabilities c WHERE c.user_id=p.user_id),'[]') capabilities,
 COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM workconnect_profile_skills ps JOIN workconnect_skills s ON s.id=ps.skill_id WHERE ps.user_id=p.user_id),'[]') skills,
 COALESCE((SELECT json_agg(json_build_object('id',l.id,'label',l.label,'city',l.city,'district',l.district,'state',l.state,'countryCode',l.country_code,'radiusKm',l.radius_km,'isPrimary',l.is_primary) ORDER BY l.is_primary DESC,l.id) FROM workconnect_service_locations l WHERE l.user_id=p.user_id),'[]') service_locations,
 (SELECT COUNT(*)::int FROM workconnect_follows f WHERE f.followed_user_id=p.user_id) follower_count,
 EXISTS(SELECT 1 FROM workconnect_follows f WHERE f.followed_user_id=p.user_id AND f.follower_user_id=$2) is_following,
 (SELECT ROUND(AVG(rv.rating)::numeric,2) FROM workconnect_reviews rv WHERE rv.reviewed_user_id=p.user_id) rating,
 (SELECT COUNT(*)::int FROM workconnect_reviews rv WHERE rv.reviewed_user_id=p.user_id) review_count
 FROM workconnect_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1`,[targetId,viewerId]);
 if(!r.rowCount)return null; const p=r.rows[0];
 if(targetId!==viewerId){delete p.contact_preferences; delete p.email_verified; p.service_locations=(p.service_locations||[]).map(l=>({...l,latitude:undefined,longitude:undefined}));}
 return p;
}
async function discoverProfessionals(db,viewerId,sp){
 const q=(sp.get('q')||'').trim().slice(0,100),lat=numOrNull(sp.get('lat')),lng=numOrNull(sp.get('lng')),radius=Math.min(Math.max(Number(sp.get('radius')||25),1),1000),page=pageNum(sp);
 const params=[viewerId,q?`%${q}%`:null,lat,lng,radius,PAGE_SIZE,(page-1)*PAGE_SIZE];
 const distance=`CASE WHEN $3::float8 IS NULL OR $4::float8 IS NULL THEN NULL ELSE 6371*2*ASIN(SQRT(POWER(SIN(RADIANS((l.latitude-$3)/2)),2)+COS(RADIANS($3))*COS(RADIANS(l.latitude))*POWER(SIN(RADIANS((l.longitude-$4)/2)),2))) END`;
 const r=await db.query(`SELECT p.user_id,u.username,p.headline,p.profession,p.years_experience,p.availability,p.avatar_url,p.credential_status,
 COALESCE(array_agg(DISTINCT s.name) FILTER(WHERE s.name IS NOT NULL),'{}') skills,MIN(${distance}) distance_km,
 (SELECT ROUND(AVG(rv.rating)::numeric,2) FROM workconnect_reviews rv WHERE rv.reviewed_user_id=p.user_id) rating,(SELECT COUNT(*)::int FROM workconnect_reviews rv WHERE rv.reviewed_user_id=p.user_id) review_count
 FROM workconnect_profiles p JOIN users u ON u.id=p.user_id LEFT JOIN workconnect_service_locations l ON l.user_id=p.user_id LEFT JOIN workconnect_profile_skills ps ON ps.user_id=p.user_id LEFT JOIN workconnect_skills s ON s.id=ps.skill_id
 WHERE p.user_id<>$1 AND NOT EXISTS(SELECT 1 FROM workconnect_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=p.user_id) OR (b.blocker_user_id=p.user_id AND b.blocked_user_id=$1))
 AND ($2::text IS NULL OR p.profession ILIKE $2 OR p.headline ILIKE $2 OR s.name ILIKE $2 OR EXISTS(SELECT 1 FROM workconnect_categories c WHERE c.id=p.primary_category_id AND (c.name ILIKE $2 OR EXISTS(SELECT 1 FROM unnest(c.aliases) a WHERE a ILIKE $2))))
 GROUP BY p.user_id,u.username
 HAVING $3::float8 IS NULL OR $4::float8 IS NULL OR MIN(${distance}) <= LEAST($5::float8,COALESCE(MAX(l.radius_km)::float8,$5::float8))
 ORDER BY CASE WHEN $3::float8 IS NULL THEN NULL ELSE MIN(${distance}) END ASC NULLS LAST,p.updated_at DESC LIMIT $6 OFFSET $7`,params);
 return {professionals:r.rows,page,hasMore:r.rows.length===PAGE_SIZE};
}
async function globalSearch(db,userId,sp){const q=(sp.get('q')||'').trim();if(!q)return{professionals:[],jobs:[],posts:[],projects:[]};const like=`%${q.slice(0,100)}%`;const [p,j,po,pr]=await Promise.all([
 db.query(`SELECT p.user_id,u.username,p.headline,p.profession FROM workconnect_profiles p JOIN users u ON u.id=p.user_id WHERE (u.username ILIKE $1 OR p.profession ILIKE $1 OR p.headline ILIKE $1) AND p.user_id<>$2 LIMIT 20`,[like,userId]),
 db.query(`SELECT id,title,kind,location_label,status,published_at FROM workconnect_jobs WHERE status='published' AND (title ILIKE $1 OR description ILIKE $1) ORDER BY published_at DESC LIMIT 20`,[like]),
 db.query(`SELECT po.id,po.body,po.category,po.created_at,u.username,po.author_user_id FROM workconnect_posts po JOIN users u ON u.id=po.author_user_id WHERE po.body ILIKE $1 ORDER BY po.created_at DESC LIMIT 20`,[like]),
 db.query(`SELECT pp.id,pp.title,pp.description,pp.location_label,u.username,pp.user_id FROM workconnect_portfolio_projects pp JOIN users u ON u.id=pp.user_id WHERE pp.title ILIKE $1 OR pp.description ILIKE $1 ORDER BY pp.created_at DESC LIMIT 20`,[like])]); return{professionals:p.rows,jobs:j.rows,posts:po.rows,projects:pr.rows};}
async function listPosts(db,userId,sp){const page=pageNum(sp),cat=sp.get('category'),scope=sp.get('scope')==='following'?'following':'public';const r=await db.query(`SELECT p.*,u.username,pr.headline,pr.profession,pr.avatar_url,(SELECT COUNT(*)::int FROM workconnect_post_likes l WHERE l.post_id=p.id) like_count,EXISTS(SELECT 1 FROM workconnect_post_likes l WHERE l.post_id=p.id AND l.user_id=$1) liked,(SELECT COUNT(*)::int FROM workconnect_post_comments c WHERE c.post_id=p.id) comment_count FROM workconnect_posts p JOIN users u ON u.id=p.author_user_id LEFT JOIN workconnect_profiles pr ON pr.user_id=p.author_user_id WHERE ($2::text IS NULL OR p.category=$2) AND ($3='public' OR p.author_user_id=$1 OR EXISTS(SELECT 1 FROM workconnect_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=p.author_user_id)) AND NOT EXISTS(SELECT 1 FROM workconnect_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=p.author_user_id) OR (b.blocker_user_id=p.author_user_id AND b.blocked_user_id=$1)) ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5`,[userId,cat||null,scope,PAGE_SIZE,(page-1)*PAGE_SIZE]);return{posts:r.rows,page,hasMore:r.rows.length===PAGE_SIZE};}
async function listJobs(db,userId,sp){const page=pageNum(sp),q=(sp.get('q')||'').trim(),kind=sp.get('kind'),mine=sp.get('mine')==='1';const r=await db.query(`SELECT j.*,u.username owner_name,c.name category_name,(SELECT COUNT(*)::int FROM workconnect_job_applications a WHERE a.job_id=j.id) application_count FROM workconnect_jobs j JOIN users u ON u.id=j.owner_user_id LEFT JOIN workconnect_categories c ON c.id=j.category_id WHERE ($1::boolean AND j.owner_user_id=$2 OR NOT $1::boolean AND j.status='published' AND (j.deadline IS NULL OR j.deadline>NOW())) AND ($3::text='' OR j.title ILIKE '%'||$3||'%' OR j.description ILIKE '%'||$3||'%') AND ($4::text IS NULL OR j.kind=$4) ORDER BY COALESCE(j.published_at,j.created_at) DESC LIMIT $5 OFFSET $6`,[mine,userId,q,['employment','service_contract'].includes(kind)?kind:null,PAGE_SIZE,(page-1)*PAGE_SIZE]);return{jobs:r.rows,page,hasMore:r.rows.length===PAGE_SIZE};}
async function handleApplicationStatus(db,res,userId,id,b){const allowed=['reviewed','shortlisted','accepted','rejected','withdrawn'];if(!allowed.includes(b.status))return json(res,400,{error:'Invalid application status.'});const a=await db.query(`SELECT a.*,j.owner_user_id FROM workconnect_job_applications a JOIN workconnect_jobs j ON j.id=a.job_id WHERE a.id=$1`,[id]);if(!a.rowCount)return json(res,404,{error:'Application not found.'});const row=a.rows[0];if(b.status==='withdrawn'){if(Number(row.applicant_user_id)!==userId)return json(res,403,{error:'Only the applicant can withdraw.'});if(!['submitted','reviewed','shortlisted'].includes(row.status))return json(res,409,{error:'This application can no longer be withdrawn.'});}else{if(Number(row.owner_user_id)!==userId)return json(res,403,{error:'Only the listing owner can update this status.'});const transitions={submitted:['reviewed','shortlisted','accepted','rejected'],reviewed:['shortlisted','accepted','rejected'],shortlisted:['accepted','rejected'],accepted:[],rejected:[],withdrawn:[]};if(!(transitions[row.status]||[]).includes(b.status))return json(res,409,{error:`Cannot change an application from ${row.status} to ${b.status}.`});}const r=await db.query('UPDATE workconnect_job_applications SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,b.status]);await notify(db,Number(row.applicant_user_id),userId,'application_status','application',id,`Your application status changed to ${b.status}.`,`application-status:${id}:${b.status}`);return json(res,200,{application:r.rows[0]});}
async function handleInquiryStatus(db,res,userId,id,b){const allowed=['worker_responded','accepted','declined','in_progress','completed','cancelled'];if(!allowed.includes(b.status))return json(res,400,{error:'Invalid inquiry status.'});const q=await db.query('SELECT * FROM workconnect_service_inquiries WHERE id=$1',[id]);if(!q.rowCount)return json(res,404,{error:'Inquiry not found.'});const i=q.rows[0],isCustomer=Number(i.customer_user_id)===userId,isWorker=Number(i.worker_user_id)===userId;if(!isCustomer&&!isWorker)return json(res,403,{error:'Inquiry not available.'});const byRole=isWorker?{sent:['worker_responded','declined'],worker_responded:['declined'],quote_proposed:[],accepted:['in_progress'],in_progress:['completed'],completed:[],declined:[],cancelled:[]}: {sent:['cancelled'],worker_responded:['cancelled'],quote_proposed:['accepted','declined','cancelled'],accepted:['cancelled'],in_progress:['completed','cancelled'],completed:[],declined:[],cancelled:[]};if(!(byRole[i.status]||[]).includes(b.status))return json(res,409,{error:`Cannot change this inquiry from ${i.status} to ${b.status}.`});const r=await db.query('UPDATE workconnect_service_inquiries SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,b.status]);return json(res,200,{inquiry:r.rows[0]});}
async function createQuote(db,res,userId,id,b){const q=await db.query(`SELECT * FROM workconnect_service_inquiries WHERE id=$1 AND worker_user_id=$2 AND status IN ('sent','worker_responded')`,[id,userId]);if(!q.rowCount)return json(res,409,{error:'This inquiry is not in a state that accepts a new quote.'});const r=await db.withTransaction(async c=>{const x=await c.query(`INSERT INTO workconnect_service_quotes(inquiry_id,worker_user_id,amount_minor,currency,message) VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,userId,money(b.amountMinor),currency(b.currency),textOptional(b.message,3000)]);await c.query(`UPDATE workconnect_service_inquiries SET status='quote_proposed',updated_at=NOW() WHERE id=$1`,[id]);return x.rows[0];});await notify(db,Number(q.rows[0].customer_user_id),userId,'quote','inquiry',id,'A professional proposed a quote.',`quote:${r.id}`);return json(res,201,{quote:r});}
async function updateQuote(db,res,userId,id,b){if(!['accepted','declined'].includes(b.status))return json(res,400,{error:'Invalid quote status.'});const q=await db.query(`SELECT q.*,i.customer_user_id,i.status inquiry_status FROM workconnect_service_quotes q JOIN workconnect_service_inquiries i ON i.id=q.inquiry_id WHERE q.id=$1`,[id]);if(!q.rowCount)return json(res,404,{error:'Quote not found.'});if(Number(q.rows[0].customer_user_id)!==userId)return json(res,403,{error:'Only the customer can respond to the quote.'});if(q.rows[0].status!=='proposed'||q.rows[0].inquiry_status!=='quote_proposed')return json(res,409,{error:'This quote is no longer awaiting a response.'});const r=await db.withTransaction(async c=>{const x=await c.query('UPDATE workconnect_service_quotes SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,b.status]);await c.query(`UPDATE workconnect_service_inquiries SET status=$2,updated_at=NOW() WHERE id=$1`,[q.rows[0].inquiry_id,b.status]);return x.rows[0];});return json(res,200,{quote:r});}
async function listConversations(db,userId){const r=await db.query(`SELECT c.id,c.context_type,c.context_id,c.updated_at,(SELECT json_agg(json_build_object('userId',u.id,'username',u.username)) FROM workconnect_conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id) participants,(SELECT body FROM workconnect_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) last_message,(SELECT COUNT(*)::int FROM workconnect_messages m WHERE m.conversation_id=c.id AND m.sender_user_id<>$1 AND m.created_at>COALESCE(cp.last_read_at,'epoch')) unread_count FROM workconnect_conversations c JOIN workconnect_conversation_participants cp ON cp.conversation_id=c.id AND cp.user_id=$1 ORDER BY c.updated_at DESC LIMIT 100`,[userId]);return{conversations:r.rows};}
async function createConversation(db,res,userId,b){const other=positiveInt(b.userId);if(!other||other===userId)return json(res,400,{error:'Choose another user.'});if(await isBlocked(db,userId,other))return json(res,403,{error:'Conversation unavailable.'});const r=await db.withTransaction(async c=>{const existing=await c.query(`SELECT cp.conversation_id FROM workconnect_conversation_participants cp JOIN workconnect_conversation_participants op ON op.conversation_id=cp.conversation_id AND op.user_id=$2 JOIN workconnect_conversations cv ON cv.id=cp.conversation_id WHERE cp.user_id=$1 AND cv.context_type=$3 AND cv.context_id IS NOT DISTINCT FROM $4::bigint LIMIT 1`,[userId,other,['profile','job','inquiry'].includes(b.contextType)?b.contextType:'profile',nullableInt(b.contextId)]);if(existing.rowCount)return existing.rows[0].conversation_id;const x=await c.query('INSERT INTO workconnect_conversations(context_type,context_id) VALUES($1,$2) RETURNING id',[['profile','job','inquiry'].includes(b.contextType)?b.contextType:'profile',nullableInt(b.contextId)]);await c.query('INSERT INTO workconnect_conversation_participants(conversation_id,user_id) VALUES($1,$2),($1,$3)',[x.rows[0].id,userId,other]);return x.rows[0].id;});return json(res,201,{conversationId:r});}
async function getMessages(db,userId,cid,sp){const m=await db.query('SELECT 1 FROM workconnect_conversation_participants WHERE conversation_id=$1 AND user_id=$2',[cid,userId]);if(!m.rowCount)return{error:'Conversation not available.',messages:[]};const before=positiveInt(sp.get('before'));const r=await db.query(`SELECT m.*,u.username FROM workconnect_messages m JOIN users u ON u.id=m.sender_user_id WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 50`,[cid,before]);return{messages:r.rows.reverse(),hasMore:r.rows.length===50};}
async function createReview(db,res,userId,b){const inquiryId=positiveInt(b.inquiryId),rating=Number(b.rating);if(!inquiryId||!Number.isInteger(rating)||rating<1||rating>5)return json(res,400,{error:'Select a completed service and rating from 1 to 5.'});const i=await db.query(`SELECT * FROM workconnect_service_inquiries WHERE id=$1 AND customer_user_id=$2 AND status='completed'`,[inquiryId,userId]);if(!i.rowCount)return json(res,403,{error:'Only the customer can review a completed platform service.'});try{const r=await db.query(`INSERT INTO workconnect_reviews(inquiry_id,reviewer_user_id,reviewed_user_id,rating,feedback) VALUES($1,$2,$3,$4,$5) RETURNING *`,[inquiryId,userId,i.rows[0].worker_user_id,rating,textOptional(b.feedback,3000)]);return json(res,201,{review:r.rows[0]});}catch(e){if(e.code==='23505')return json(res,409,{error:'This completed service already has a review.'});throw e;}}
async function notify(db,userId,actor,type,entityType,entityId,message,key){if(userId===actor)return;await db.query(`INSERT INTO workconnect_notifications(user_id,actor_user_id,type,entity_type,entity_id,message,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,[userId,actor,type,entityType,entityId,message,key]);}
async function isBlocked(db,a,b){const r=await db.query(`SELECT 1 FROM workconnect_blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1) LIMIT 1`,[a,b]);return r.rowCount>0;}
async function conversationBlocked(db,cid,userId){const r=await db.query(`SELECT 1 FROM workconnect_conversation_participants me JOIN workconnect_conversation_participants other ON other.conversation_id=me.conversation_id AND other.user_id<>me.user_id JOIN workconnect_blocks b ON (b.blocker_user_id=me.user_id AND b.blocked_user_id=other.user_id) OR (b.blocker_user_id=other.user_id AND b.blocked_user_id=me.user_id) WHERE me.conversation_id=$1 AND me.user_id=$2 LIMIT 1`,[cid,userId]);return r.rowCount>0;}
async function attachMedia(db,userId,purpose,entityId,ids){if(!Array.isArray(ids))return;for(const id of ids.slice(0,10)){if(!/^[0-9a-f-]{36}$/i.test(String(id)))continue;if(purpose==='post')await db.query(`INSERT INTO workconnect_post_media(post_id,media_id) SELECT $1,id FROM workconnect_media WHERE id=$2 AND owner_user_id=$3 ON CONFLICT DO NOTHING`,[entityId,id,userId]);else await db.query(`INSERT INTO workconnect_portfolio_media(project_id,media_id) SELECT $1,id FROM workconnect_media WHERE id=$2 AND owner_user_id=$3 ON CONFLICT DO NOTHING`,[entityId,id,userId]);}}
async function uploadMedia(req,res,db,userId,sp){const purpose=sp.get('purpose')||'post',mime=(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();if(!ALLOWED_MEDIA.has(mime))return json(res,415,{error:'Unsupported file type.'});const isPublic=PUBLIC_MEDIA_PURPOSES.has(purpose);const buf=await readBytes(req,MAX_MEDIA_BYTES);if(!buf.length)return json(res,400,{error:'File is empty.'});if(!magicMatches(buf,mime))return json(res,415,{error:'File content does not match its declared type.'});const root=getMediaRoot(),id=crypto.randomUUID(),ext=ALLOWED_MEDIA.get(mime),dir=path.join(root,String(userId));await fs.mkdir(dir,{recursive:true});const storageKey=`${userId}/${id}${ext}`,full=path.join(root,storageKey);await fs.writeFile(full,buf,{flag:'wx',mode:0o600});const name=safeFilename(decodeURIComponent(sp.get('name')||`upload${ext}`));try{await db.query(`INSERT INTO workconnect_media(id,owner_user_id,purpose,storage_key,original_name,mime_type,byte_size,is_public) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,userId,purpose,storageKey,name,mime,buf.length,isPublic]);if(purpose==='avatar')await db.query('UPDATE workconnect_profiles SET avatar_url=$2,updated_at=NOW() WHERE user_id=$1',[userId,`/api/workconnect/media/${id}`]);if(purpose==='cover')await db.query('UPDATE workconnect_profiles SET cover_url=$2,updated_at=NOW() WHERE user_id=$1',[userId,`/api/workconnect/media/${id}`]);}catch(e){await fs.unlink(full).catch(()=>{});throw e;}return json(res,201,{media:{id,url:`/api/workconnect/media/${id}`,mimeType:mime,byteSize:buf.length,isPublic}});}
async function serveMedia(res,db,userId,id){const r=await db.query('SELECT * FROM workconnect_media WHERE id=$1',[id]);if(!r.rowCount)return json(res,404,{error:'Media not found.'});const m=r.rows[0];if(!m.is_public&&Number(m.owner_user_id)!==userId)return json(res,403,{error:'Media is private.'});try{const data=await fs.readFile(path.join(getMediaRoot(),m.storage_key));res.writeHead(200,{'Content-Type':m.mime_type,'Content-Length':data.length,'Cache-Control':m.is_public?'public, max-age=3600':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`${m.is_public?'inline':'attachment'}; filename="${safeFilename(m.original_name)}"`});res.end(data);}catch(e){if(e.code==='ENOENT')return json(res,404,{error:'Media file is missing.'});throw e;}}
async function deleteMedia(res,db,userId,id){const r=await db.query('DELETE FROM workconnect_media WHERE id=$1 AND owner_user_id=$2 RETURNING storage_key',[id,userId]);if(!r.rowCount)return json(res,404,{error:'Media not found.'});await fs.unlink(path.join(getMediaRoot(),r.rows[0].storage_key)).catch(()=>{});return json(res,200,{deleted:true});}

function validateProfile(b){return{headline:textOptional(b.headline,160),accountType:['student','skilled_worker','professional','contractor','customer','employer'].includes(b.accountType)?b.accountType:'professional',profession:textOptional(b.profession,120),primaryCategoryId:nullableInt(b.primaryCategoryId),yearsExperience:b.yearsExperience===''||b.yearsExperience==null?null:boundedInt(b.yearsExperience,0,80,'Years of experience'),bio:textOptional(b.bio,5000),education:textOptional(b.education,3000),availability:['available','busy','unavailable','open_to_offers'].includes(b.availability)?b.availability:'available',scheduleText:textOptional(b.scheduleText,200),employmentType:textOptional(b.employmentType,40),startingRateMinor:moneyOrNull(b.startingRateMinor),rateCurrency:currency(b.rateCurrency),contactPreferences:plainObject(b.contactPreferences),publicFields:plainObject(b.publicFields),college:textOptional(b.college,180)||null,department:textOptional(b.department,180)||null};}
function validateLocation(b){const lat=Number(b.latitude),lng=Number(b.longitude),radius=Number(b.radiusKm||10);if(!Number.isFinite(lat)||lat < -90||lat>90||!Number.isFinite(lng)||lng < -180||lng>180)throw clientError('Valid latitude and longitude are required.');if(!Number.isFinite(radius)||radius<=0||radius>1000)throw clientError('Service radius must be between 0 and 1000 km.');return{label:text(b.label,1,160,'Location label'),city:textOptional(b.city,100),district:textOptional(b.district,100),state:textOptional(b.state,100),postalCode:textOptional(b.postalCode,20),countryCode:/^[A-Z]{2}$/.test(String(b.countryCode||'IN').toUpperCase())?String(b.countryCode||'IN').toUpperCase():'IN',latitude:lat,longitude:lng,radiusKm:radius,isPrimary:b.isPrimary===true};}
function validateJob(b){const status=['draft','published','closed','filled','cancelled','expired'].includes(b.status)?b.status:'draft';return{kind:['employment','service_contract'].includes(b.kind)?b.kind:'employment',title:text(b.title,1,180,'Job title'),categoryId:nullableInt(b.categoryId),description:text(b.description,1,10000,'Description'),locationLabel:textOptional(b.locationLabel,180),latitude:coordOrNull(b.latitude,-90,90,'latitude'),longitude:coordOrNull(b.longitude,-180,180,'longitude'),workplaceType:['onsite','remote','hybrid'].includes(b.workplaceType)?b.workplaceType:'onsite',contractType:textOptional(b.contractType,40),durationText:textOptional(b.durationText,120),experienceYears:b.experienceYears==null||b.experienceYears===''?null:boundedInt(b.experienceYears,0,80,'Experience'),minAmountMinor:moneyOrNull(b.minAmountMinor),maxAmountMinor:moneyOrNull(b.maxAmountMinor),currency:currency(b.currency),openings:boundedInt(b.openings||1,1,1000,'Openings'),deadline:dateTimeOrNull(b.deadline),status};}
function validCapability(v){return['student','offer_services','apply_jobs','post_jobs','hire_services'].includes(v);}
function postCategory(v){return['completed_work','project_update','certification','achievement','job_opportunity','available_for_work','general'].includes(v)?v:'general';}
function plainObject(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function currency(v){const x=String(v||'INR').toUpperCase();return /^[A-Z]{3}$/.test(x)?x:'INR';}
function text(v,min,max,label){const s=String(v??'').trim();if(s.length<min||s.length>max)throw clientError(`${label} must be between ${min} and ${max} characters.`);return s;}
function textOptional(v,max){return String(v??'').trim().slice(0,max);}
function boundedInt(v,min,max,label){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw clientError(`${label} must be between ${min} and ${max}.`);return n;}
function positiveInt(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null;} function nullableInt(v){return v==null||v===''?null:positiveInt(v);} function money(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw clientError('Amount must be a non-negative integer in minor currency units.');return n;} function moneyOrNull(v){return v==null||v===''?null:money(v);} function numOrNull(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function coordOrNull(v,min,max,label){if(v==null||v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw clientError(`Invalid ${label}.`);return n;}
function dateOrNull(v){if(!v)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))throw clientError('Invalid date.');return String(v);} function dateTimeOrNull(v){if(!v)return null;const d=new Date(v);if(Number.isNaN(d.getTime()))throw clientError('Invalid date/time.');return d.toISOString();}
function pageNum(sp){return Math.max(1,Math.min(10000,positiveInt(sp.get('page'))||1));} function slugify(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);} function uniqueStrings(a,max,len){return [...new Set(a.map(x=>String(x).trim()).filter(Boolean))].slice(0,max).map(x=>x.slice(0,len));}
function getMediaRoot(){const configured=String(process.env.WORKCONNECT_MEDIA_ROOT||'').trim();return configured?path.resolve(configured):DEFAULT_MEDIA_ROOT;}
function safeFilename(v){return String(v||'file').replace(/[\r\n"\\/]/g,'_').replace(/[^\w.() -]/g,'_').slice(0,180)||'file';}
function magicMatches(b,m){if(m==='image/jpeg')return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;if(m==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(m==='image/gif')return ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString('ascii'));if(m==='image/webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';if(m==='application/pdf')return b.subarray(0,5).toString()==='%PDF-';if(m==='video/mp4')return b.subarray(4,8).toString()==='ftyp';if(m==='video/webm')return b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));return false;}
function clientError(msg,status=400){const e=new Error(msg);e.publicMessage=msg;e.statusCode=status;return e;}
async function readJson(req,limit=1024*1024){const b=await readBytes(req,limit);if(!b.length)return{};try{return JSON.parse(b.toString('utf8'));}catch{throw clientError('Request body must be valid JSON.');}}
async function readBytes(req,limit){const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw clientError('Request body is too large.',413);parts.push(chunk);}return Buffer.concat(parts);}
function json(res,status,obj){if(res.writableEnded)return;const body=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});res.end(body);}

module.exports={createWorkConnectService,slugify,magicMatches};
