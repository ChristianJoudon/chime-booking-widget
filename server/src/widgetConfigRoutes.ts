import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

export function createPublicWidgetConfigRouter(pool: Pool) {
  const router = Router();

  router.get('/:organizationSlug/:widgetSlug', asyncRoute(async (request, response) => {
    const organizationValue = request.params.organizationSlug;
    const widgetValue = request.params.widgetSlug;
    const organizationSlug = typeof organizationValue === 'string' ? organizationValue.toLowerCase() : undefined;
    const widgetSlug = typeof widgetValue === 'string' ? widgetValue.toLowerCase() : undefined;
    if (!organizationSlug || !widgetSlug) {
      response.status(400).json({ error: 'Organization and widget slugs are required.' });
      return;
    }

    const result = await pool.query<{
      organization_slug: string;
      slug: string;
      theme: Record<string, unknown>;
      copy: Record<string, unknown>;
      field_settings: Record<string, unknown>;
      locale: string;
      time_zone: string;
      version: number;
    }>(
      `SELECT organization.slug AS organization_slug,
              config.slug,
              config.theme,
              config.copy,
              config.field_settings,
              config.locale,
              config.time_zone,
              config.version
         FROM chime_app.widget_configs config
         JOIN chime_app.organizations organization ON organization.id = config.organization_id
        WHERE organization.slug = $1
          AND config.slug = $2
          AND config.is_active = true
        LIMIT 1`,
      [organizationSlug, widgetSlug],
    );
    const config = result.rows[0];
    if (!config) {
      response.status(404).json({ error: 'Widget design not found.' });
      return;
    }

    response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    response.json({
      widget: {
        organizationSlug: config.organization_slug,
        slug: config.slug,
        theme: config.theme,
        copy: config.copy,
        fieldSettings: config.field_settings,
        locale: config.locale,
        timeZone: config.time_zone,
        version: Number(config.version),
      },
    });
  }));

  return router;
}
