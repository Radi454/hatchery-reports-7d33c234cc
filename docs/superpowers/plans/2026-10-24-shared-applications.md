# Shared application accounting

User specification: preserve separate reports and product ownership for each representative/region when they describe one physical flock. Count birds once globally, while each region and product retains its own covered birds. Never group by coincidentally equal dates/counts. Two hatcheries and engineers are distinct applications unless explicitly confirmed otherwise.

Implementation: a private, explicitly approved report-to-application mapping. The authenticated dashboard RPC returns its application key. Existing unlinked reports retain current behavior. Dashboard total/customer/month charts count each application once within the current filter; regional and product totals count it once within their respective group. Report counts remain source-report counts. Product lines are corrected only for user-confirmed cases; no mass historical changes.

- [x] Test shared-flock totals, regional/product attribution, independent identical batches, filters and charts.
- [ ] Implement explicit private mapping, RPC field, and shared counting helper.
- [ ] Save finalized January corrections, original images, and approved report allocation with economical saving executor; preserve Excel hashes and null Storage fields.
- [ ] Verify database rows, allocations, source hashes, test/build output, and deployed dashboard.

Potential limits: January full-field extraction remains ongoing; this change does not claim the entire archive/month is saved. Unknown product attribution is not guessed.
